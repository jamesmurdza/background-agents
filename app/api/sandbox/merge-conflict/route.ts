import { prisma } from "@/lib/prisma"
import { ensureSandboxStarted } from "@/lib/sandbox-resume"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
  internalError,
} from "@/lib/api-helpers"

// Timeout for merge conflict operations - 60 seconds
export const maxDuration = 60

export interface ConflictFile {
  path: string
  oursContent: string
  theirsContent: string
  baseContent: string
  conflictMarkers: string
}

export interface MergeConflictInfo {
  conflictFiles: ConflictFile[]
  currentBranch: string
  targetBranch: string
  mergeBranch: string
}

/**
 * Parse conflict markers in a file to extract ours, theirs, and base content
 */
function parseConflictMarkers(content: string): { ours: string; theirs: string; base: string } | null {
  // Check if the file has conflict markers
  if (!content.includes("<<<<<<<") || !content.includes(">>>>>>>")) {
    return null
  }

  let ours = ""
  let theirs = ""
  let base = ""
  let inOurs = false
  let inBase = false
  let inTheirs = false

  const lines = content.split("\n")
  for (const line of lines) {
    if (line.startsWith("<<<<<<<")) {
      inOurs = true
      continue
    }
    if (line.startsWith("|||||||")) {
      inOurs = false
      inBase = true
      continue
    }
    if (line.startsWith("=======")) {
      inOurs = false
      inBase = false
      inTheirs = true
      continue
    }
    if (line.startsWith(">>>>>>>")) {
      inTheirs = false
      continue
    }

    if (inOurs) {
      ours += line + "\n"
    } else if (inBase) {
      base += line + "\n"
    } else if (inTheirs) {
      theirs += line + "\n"
    }
  }

  return { ours: ours.trimEnd(), theirs: theirs.trimEnd(), base: base.trimEnd() }
}

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, repoPath, action, targetBranch, currentBranch, filePath, resolution, resolvedContent } = body

  if (!sandboxId || !repoPath || !action) {
    return badRequest("Missing required fields")
  }

  // Verify ownership
  const sandboxRecord = await prisma.sandbox.findUnique({
    where: { sandboxId },
  })

  if (!sandboxRecord || sandboxRecord.userId !== auth.userId) {
    return notFound("Sandbox not found")
  }

  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Get GitHub token from NextAuth
  const account = await prisma.account.findFirst({
    where: { userId: auth.userId, provider: "github" },
  })
  const githubToken = account?.access_token

  try {
    const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxId)

    switch (action) {
      case "start-merge": {
        // Start a merge that might have conflicts - don't abort on conflict
        if (!githubToken || !targetBranch || !currentBranch) {
          return badRequest("Missing required fields for merge")
        }

        // First checkout the target branch
        try {
          await sandbox.git.checkoutBranch(repoPath, targetBranch)
        } catch (err) {
          return Response.json({
            error: "Failed to checkout target: " + (err instanceof Error ? err.message : "Unknown error")
          }, { status: 500 })
        }

        // Pull latest on target
        try {
          await sandbox.git.pull(repoPath, "x-access-token", githubToken)
        } catch {
          // May fail if target is already up to date
        }

        // Attempt the merge (don't use --no-edit so we can handle conflicts)
        const mergeResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git merge ${currentBranch} --no-commit 2>&1`
        )

        if (mergeResult.exitCode) {
          // Check if it's a conflict
          const statusResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
          )

          const conflictedFiles = statusResult.result
            .trim()
            .split("\n")
            .filter(Boolean)

          if (conflictedFiles.length > 0) {
            // Get conflict details for each file
            const conflictFiles: ConflictFile[] = []

            for (const file of conflictedFiles) {
              // Get the file content with conflict markers
              const contentResult = await sandbox.process.executeCommand(
                `cd ${repoPath} && cat "${file}" 2>&1`
              )
              const conflictMarkers = contentResult.result

              // Get ours version (HEAD)
              const oursResult = await sandbox.process.executeCommand(
                `cd ${repoPath} && git show :2:"${file}" 2>/dev/null || echo ""`
              )

              // Get theirs version (the branch being merged)
              const theirsResult = await sandbox.process.executeCommand(
                `cd ${repoPath} && git show :3:"${file}" 2>/dev/null || echo ""`
              )

              // Get base version (common ancestor)
              const baseResult = await sandbox.process.executeCommand(
                `cd ${repoPath} && git show :1:"${file}" 2>/dev/null || echo ""`
              )

              conflictFiles.push({
                path: file,
                oursContent: oursResult.result || "",
                theirsContent: theirsResult.result || "",
                baseContent: baseResult.result || "",
                conflictMarkers,
              })
            }

            return Response.json({
              hasConflicts: true,
              conflictFiles,
              currentBranch,
              targetBranch,
              message: mergeResult.result,
            })
          }

          // Not a conflict, some other error - abort
          await sandbox.process.executeCommand(`cd ${repoPath} && git merge --abort 2>&1`)
          await sandbox.git.checkoutBranch(repoPath, currentBranch)
          return Response.json({
            error: "Merge failed: " + mergeResult.result
          }, { status: 500 })
        }

        // No conflicts - complete the merge
        const commitResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git commit --no-edit 2>&1`
        )

        if (commitResult.exitCode && !commitResult.result.includes("nothing to commit")) {
          return Response.json({
            error: "Commit failed: " + commitResult.result
          }, { status: 500 })
        }

        // Push the merged target
        await sandbox.git.push(repoPath, "x-access-token", githubToken)

        // Switch back to current branch
        await sandbox.git.checkoutBranch(repoPath, currentBranch)

        return Response.json({
          hasConflicts: false,
          success: true,
          message: `Successfully merged ${currentBranch} into ${targetBranch}`
        })
      }

      case "resolve-file": {
        // Resolve a single conflicted file
        if (!filePath || !resolution) {
          return badRequest("Missing filePath or resolution")
        }

        let fileContent: string

        if (resolution === "ours") {
          // Keep the target branch's version (HEAD during merge = target)
          const result = await sandbox.process.executeCommand(
            `cd ${repoPath} && git checkout --ours "${filePath}" 2>&1`
          )
          if (result.exitCode) {
            return Response.json({ error: "Failed to resolve: " + result.result }, { status: 500 })
          }
        } else if (resolution === "theirs") {
          // Take the incoming branch's version
          const result = await sandbox.process.executeCommand(
            `cd ${repoPath} && git checkout --theirs "${filePath}" 2>&1`
          )
          if (result.exitCode) {
            return Response.json({ error: "Failed to resolve: " + result.result }, { status: 500 })
          }
        } else if (resolution === "custom" && resolvedContent !== undefined) {
          // Write custom content
          // Use a temporary file to handle content with special characters
          const escapedContent = resolvedContent.replace(/'/g, "'\\''")
          const writeResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && cat > "${filePath}" << 'ENDOFCONTENT'\n${resolvedContent}\nENDOFCONTENT`
          )
          if (writeResult.exitCode) {
            // Try alternative method
            const base64Content = Buffer.from(resolvedContent).toString('base64')
            const altResult = await sandbox.process.executeCommand(
              `cd ${repoPath} && echo "${base64Content}" | base64 -d > "${filePath}"`
            )
            if (altResult.exitCode) {
              return Response.json({ error: "Failed to write resolved content" }, { status: 500 })
            }
          }
        } else {
          return badRequest("Invalid resolution type")
        }

        // Stage the resolved file
        const addResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git add "${filePath}" 2>&1`
        )

        if (addResult.exitCode) {
          return Response.json({ error: "Failed to stage: " + addResult.result }, { status: 500 })
        }

        return Response.json({ success: true })
      }

      case "check-remaining": {
        // Check if there are remaining unresolved conflicts
        const statusResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
        )

        const remainingFiles = statusResult.result
          .trim()
          .split("\n")
          .filter(Boolean)

        return Response.json({
          remainingConflicts: remainingFiles.length,
          files: remainingFiles
        })
      }

      case "complete-merge": {
        // Complete the merge after all conflicts are resolved
        if (!githubToken || !currentBranch) {
          return badRequest("Missing required fields")
        }

        // Check if there are unresolved conflicts
        const checkResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git diff --name-only --diff-filter=U 2>&1`
        )

        const unresolved = checkResult.result.trim().split("\n").filter(Boolean)
        if (unresolved.length > 0) {
          return Response.json({
            error: "There are still unresolved conflicts: " + unresolved.join(", ")
          }, { status: 400 })
        }

        // Commit the merge
        const commitResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git commit --no-edit 2>&1`
        )

        if (commitResult.exitCode && !commitResult.result.includes("nothing to commit")) {
          return Response.json({
            error: "Commit failed: " + commitResult.result
          }, { status: 500 })
        }

        // Get the current branch (should be target branch during merge)
        const status = await sandbox.git.status(repoPath)
        const mergedTarget = status.currentBranch

        // Push the merged branch
        await sandbox.git.push(repoPath, "x-access-token", githubToken)

        // Switch back to the current branch
        await sandbox.git.checkoutBranch(repoPath, currentBranch)

        return Response.json({
          success: true,
          message: `Successfully merged into ${mergedTarget}`
        })
      }

      case "abort-merge": {
        // Abort the current merge
        if (!currentBranch) {
          return badRequest("Missing currentBranch")
        }

        await sandbox.process.executeCommand(`cd ${repoPath} && git merge --abort 2>&1`)
        await sandbox.git.checkoutBranch(repoPath, currentBranch)

        return Response.json({ success: true })
      }

      default:
        return badRequest(`Unknown action: ${action}`)
    }
  } catch (error: unknown) {
    return internalError(error)
  }
}
