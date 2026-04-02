import { prisma } from "@/lib/db/prisma"
import { ensureSandboxStarted } from "@/lib/sandbox/sandbox-resume"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  getDaytonaApiKey,
  isDaytonaKeyError,
  internalError,
} from "@/lib/shared/api-helpers"

// Timeout for file operations - 30 seconds
export const maxDuration = 30

/** Escape a string for use in shell commands */
function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''")
}

/** Default file extensions to watch */
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".json", ".py", ".go", ".rs", ".md", ".css", ".html", ".txt", ".log"]

/** Default patterns to ignore */
const DEFAULT_IGNORE = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "vendor"]

/**
 * Build the find command to locate files modified after the .git directory was created
 * (i.e., since the repo was cloned)
 */
function buildFindCommandSinceClone(
  path: string,
  extensions: string[],
  ignore: string[]
): string {
  const safePath = escapeShell(path)

  // Build ignore patterns for find -prune
  const ignoreArgs = ignore
    .map((pattern) => `-name '${escapeShell(pattern)}' -prune`)
    .join(" -o ")

  // Build extension match patterns
  const extPatterns = extensions
    .map((ext) => `-name '*${escapeShell(ext)}'`)
    .join(" -o ")

  // Use -newer to find files modified after .git directory was created (when repo was cloned)
  // Output: path|mtime|size (using stat for metadata)
  const command = `find '${safePath}' \\( ${ignoreArgs} \\) -o -type f \\( ${extPatterns} \\) -newer '${safePath}/.git' -print0 2>/dev/null | xargs -0 -r stat --format='%n|%Y|%s' 2>/dev/null | head -20 || true`

  return command
}

/**
 * Parse the output of find + stat command
 */
function parseStatOutput(output: string): Array<{ path: string; modifiedAt: number; size: number }> {
  const files: Array<{ path: string; modifiedAt: number; size: number }> = []
  const lines = output.trim().split("\n").filter(Boolean)

  for (const line of lines) {
    const parts = line.split("|")
    if (parts.length >= 3) {
      const path = parts[0]
      const mtime = parseInt(parts[1], 10)
      const size = parseInt(parts[2], 10)

      if (path && !isNaN(mtime) && !isNaN(size)) {
        files.push({
          path,
          modifiedAt: mtime * 1000, // Convert to milliseconds
          size,
        })
      }
    }
  }

  // Sort by modification time (most recent first) and limit to 20
  return files
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, 20)
}

export async function POST(req: Request) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const body = await req.json()
  const { sandboxId, repoPath, action, filePath, since } = body

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

  try {
    const sandbox = await ensureSandboxStarted(daytonaApiKey, sandboxId)

    switch (action) {
      case "list-modified": {
        // Get files modified since the repo was cloned (using .git dir as reference)
        const command = buildFindCommandSinceClone(repoPath, DEFAULT_EXTENSIONS, DEFAULT_IGNORE)

        const result = await sandbox.process.executeCommand(command, undefined, undefined, 30)
        const files = parseStatOutput(result.result || "")

        return Response.json({ files })
      }

      case "read-file": {
        if (!filePath) {
          return badRequest("Missing filePath")
        }

        const safePath = escapeShell(filePath)

        // Get file metadata first
        const statResult = await sandbox.process.executeCommand(
          `stat --format='%Y|%s' '${safePath}' 2>/dev/null || echo 'error'`
        )

        if (statResult.result?.trim() === "error" || statResult.exitCode !== 0) {
          return notFound("File not found")
        }

        const parts = statResult.result.trim().split("|")
        const mtime = parseInt(parts[0], 10)
        const size = parseInt(parts[1], 10)

        // Limit file size to 500KB
        if (size > 500 * 1024) {
          return Response.json({
            error: "File too large",
            path: filePath,
            size,
            modifiedAt: mtime * 1000,
          }, { status: 413 })
        }

        // Read the file content
        const readResult = await sandbox.process.executeCommand(
          `cat '${safePath}' 2>/dev/null`
        )

        return Response.json({
          path: filePath,
          content: readResult.result || "",
          modifiedAt: mtime * 1000,
          size,
        })
      }

      default:
        return badRequest(`Unknown action: ${action}`)
    }
  } catch (error: unknown) {
    return internalError(error)
  }
}
