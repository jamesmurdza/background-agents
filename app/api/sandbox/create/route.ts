import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import { checkQuota } from "@/lib/quota"
import { generateSandboxName } from "@/lib/sandbox-utils"
import { CODING_AGENT_SCRIPT } from "@/lib/coding-agent-script"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  badRequest,
  unauthorized,
  decryptUserCredentials,
} from "@/lib/api-helpers"

export const maxDuration = 300 // 5 minute timeout for sandbox creation

export async function POST(req: Request) {
  // 1. Authenticate
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { repoId, repoOwner, repoName, baseBranch, newBranch, startCommit } = body

  if (!repoOwner || !repoName || !newBranch) {
    return badRequest("Missing required fields")
  }

  // 2. Check quota
  const quota = await checkQuota(userId)
  if (!quota.allowed) {
    return Response.json({
      error: "Quota exceeded",
      message: `You have ${quota.current}/${quota.max} sandboxes. Please stop one before creating another.`,
    }, { status: 429 })
  }

  // 3. Get credentials
  const daytonaApiKey = getDaytonaApiKey()
  if (isDaytonaKeyError(daytonaApiKey)) return daytonaApiKey

  // Get GitHub token from NextAuth
  const account = await prisma.account.findFirst({
    where: { userId, provider: "github" },
  })
  const githubToken = account?.access_token
  if (!githubToken) {
    return unauthorized()
  }

  // Get user's Anthropic credentials
  const userCredentials = await prisma.userCredentials.findUnique({
    where: { userId },
  })

  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } = decryptUserCredentials(userCredentials)
  const sandboxAutoStopInterval = userCredentials?.sandboxAutoStopInterval ?? 5

  const hasAnthropicCredential =
    (anthropicAuthType === "claude-max" && anthropicAuthToken) ||
    (anthropicAuthType !== "claude-max" && anthropicApiKey)

  if (!hasAnthropicCredential) {
    return badRequest("Anthropic credentials not configured. Please add them in Settings.")
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        )
      }

      let sandboxRecord: { id: string; sandboxId: string } | null = null
      let branchRecord: { id: string } | null = null

      try {
        send({ type: "progress", message: "Creating sandbox..." })

        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandboxName = generateSandboxName(userId)

        const sandbox = await daytona.create({
          name: sandboxName,
          snapshot: "daytona-medium",
          autoStopInterval: sandboxAutoStopInterval,
          labels: {
            "sandboxed-agents": "true",
            "repo": `${repoOwner}/${repoName}`,
            "branch": newBranch,
            "userId": userId,
          },
          ...(anthropicAuthType !== "claude-max" && anthropicApiKey && {
            envVars: { ANTHROPIC_API_KEY: anthropicApiKey },
          }),
        })

        // For Claude Max, write stored credentials so the Agent SDK picks them up
        if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
          const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
          await sandbox.process.executeCommand(
            `mkdir -p /home/daytona/.claude && echo '${credentialsB64}' | base64 -d > /home/daytona/.claude/.credentials.json && chmod 600 /home/daytona/.claude/.credentials.json`
          )
        }

        send({ type: "progress", message: "Cloning repository..." })

        // Use Daytona SDK git interface
        const repoPath = `/home/daytona/${repoName}`
        const cloneUrl = `https://github.com/${repoOwner}/${repoName}.git`
        const base = baseBranch || "main"
        await sandbox.git.clone(cloneUrl, repoPath, base, undefined, "x-access-token", githubToken)

        // Set up git author config from GitHub user
        let gitName = "Sandboxed Agent"
        let gitEmail = "noreply@example.com"
        try {
          const ghRes = await fetch("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${githubToken}`, Accept: "application/vnd.github.v3+json" },
          })
          if (ghRes.ok) {
            const ghUser = await ghRes.json()
            gitName = ghUser.name || ghUser.login
            gitEmail = `${ghUser.login}@users.noreply.github.com`
          }
        } catch {}
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git config user.email "${gitEmail}" && git config user.name "${gitName}"`
        )

        // Create and checkout new branch via Daytona SDK
        send({ type: "progress", message: `Creating branch ${newBranch} from ${base}...` })
        await sandbox.git.createBranch(repoPath, newBranch)
        await sandbox.git.checkoutBranch(repoPath, newBranch)

        // If starting from a specific commit, reset to it
        if (startCommit) {
          send({ type: "progress", message: `Resetting to commit ${startCommit.slice(0, 7)}...` })
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git reset --hard ${startCommit} 2>&1`
          )
        }

        // Capture the current HEAD commit as the starting point for commit detection
        // Use git log format to ensure consistent hash format with the log action
        const headResult = await sandbox.process.executeCommand(
          `cd ${repoPath} && git log -1 --format='%h' 2>&1`
        )
        const headCommit = headResult.exitCode ? null : headResult.result.trim()
        console.log("[sandbox-create] Captured headCommit:", headCommit, "exitCode:", headResult.exitCode)

        send({ type: "progress", message: "Installing Claude Agent SDK..." })

        const installResult = await sandbox.process.executeCommand(
          "python3 -m pip install claude-agent-sdk==0.1.19 2>&1"
        )
        if (installResult.exitCode) {
          throw new Error(`Failed to install Agent SDK: ${installResult.result}`)
        }

        send({ type: "progress", message: "Initializing agent..." })

        // Write the coding agent script to the sandbox
        const scriptB64 = Buffer.from(CODING_AGENT_SCRIPT).toString("base64")
        await sandbox.process.executeCommand(
          `echo '${scriptB64}' | base64 -d > /tmp/coding_agent.py`
        )

        // Get preview URL pattern for dev server URLs
        let previewUrlPattern: string | undefined
        try {
          const previewLink = await sandbox.getPreviewLink(3000)
          previewUrlPattern = previewLink.url.replace("3000", "{port}")
        } catch {
          // Preview URLs not available — non-critical
        }

        // Create code interpreter context with the repo as working directory
        const ctx = await sandbox.codeInterpreter.createContext(repoPath)

        // Initialize the coding agent (add /tmp to path so coding_agent.py is found)
        const initResult = await sandbox.codeInterpreter.runCode(
          `import sys; sys.path.insert(0, '/tmp'); import os, coding_agent;`,
          {
            context: ctx,
            envs: { REPO_PATH: repoPath, ...(previewUrlPattern ? { PREVIEW_URL_PATTERN: previewUrlPattern } : {}) },
          }
        )
        if (initResult.error) {
          throw new Error(`Failed to initialize agent: ${initResult.error.value}`)
        }

        // Create or find the repo in database
        let dbRepo = await prisma.repo.findUnique({
          where: {
            userId_owner_name: {
              userId: userId,
              owner: repoOwner,
              name: repoName,
            },
          },
        })

        if (!dbRepo && repoId) {
          dbRepo = await prisma.repo.findUnique({
            where: { id: repoId },
          })
        }

        if (!dbRepo) {
          // Create repo if it doesn't exist
          dbRepo = await prisma.repo.create({
            data: {
              userId: userId,
              owner: repoOwner,
              name: repoName,
              defaultBranch: baseBranch || "main",
            },
          })
        }

        // Create branch record
        branchRecord = await prisma.branch.create({
          data: {
            repoId: dbRepo.id,
            name: newBranch,
            baseBranch: baseBranch || "main",
            startCommit: headCommit, // Store the HEAD commit for commit detection baseline
            status: "idle",
          },
        })

        // Create sandbox record
        sandboxRecord = await prisma.sandbox.create({
          data: {
            sandboxId: sandbox.id,
            sandboxName,
            userId: userId,
            branchId: branchRecord.id,
            contextId: ctx.id,
            previewUrlPattern,
            status: "running",
          },
        })

        console.log("[sandbox-create] Sending done event with startCommit:", headCommit)
        send({
          type: "done",
          sandboxId: sandbox.id,
          contextId: ctx.id,
          previewUrlPattern,
          branchId: branchRecord.id,
          repoId: dbRepo.id,
          startCommit: headCommit,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        send({ type: "error", message })

        // Clean up database records if created
        if (sandboxRecord) {
          await prisma.sandbox.delete({ where: { id: sandboxRecord.id } }).catch(() => {})
        }
        if (branchRecord) {
          await prisma.branch.delete({ where: { id: branchRecord.id } }).catch(() => {})
        }
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
