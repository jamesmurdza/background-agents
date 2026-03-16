import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import { checkQuota } from "@/lib/quota"
import { generateSandboxName } from "@/lib/sandbox-utils"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  badRequest,
  unauthorized,
  decryptUserCredentials,
} from "@/lib/api-helpers"
import { createSSEStream, sendProgress, sendError, sendDone } from "@/lib/streaming-helpers"
import { SANDBOX_CONFIG, PATHS } from "@/lib/constants"
import { getDefaultAgent } from "@/lib/types"

// Sandbox creation timeout - 300 seconds (must be literal for Next.js static analysis)
export const maxDuration = 300

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
    return Response.json(
      {
        error: "Quota exceeded",
        message: `You have ${quota.current}/${quota.max} sandboxes. Please stop one before creating another.`,
      },
      { status: 429 }
    )
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

  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } =
    decryptUserCredentials(userCredentials)
  const sandboxAutoStopInterval = userCredentials?.sandboxAutoStopInterval ?? 5

  // Check if user has Anthropic credentials - used to determine default agent
  const hasAnthropicCredential =
    (anthropicAuthType === "claude-max" && anthropicAuthToken) ||
    (anthropicAuthType !== "claude-max" && anthropicApiKey)

  // Determine default agent based on available credentials
  // Users without Anthropic credentials default to opencode with free models
  const defaultAgent = getDefaultAgent({
    hasAnthropicApiKey: !!anthropicApiKey,
    hasAnthropicAuthToken: !!anthropicAuthToken,
  })

  // Track records for cleanup on error
  let sandboxRecord: { id: string; sandboxId: string } | null = null
  let branchRecord: { id: string } | null = null

  return createSSEStream({
    onStart: async (controller) => {
      try {
        sendProgress(controller, "Creating sandbox...")

        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandboxName = generateSandboxName(userId)

        // Only inject Anthropic API key if using claude-code agent or opencode with Anthropic models
        // For opencode with free models, no API key is needed
        const sandbox = await daytona.create({
          name: sandboxName,
          snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
          autoStopInterval: sandboxAutoStopInterval,
          labels: {
            [SANDBOX_CONFIG.LABEL_KEY]: "true",
            repo: `${repoOwner}/${repoName}`,
            branch: newBranch,
            userId: userId,
          },
          ...(anthropicAuthType !== "claude-max" &&
            anthropicApiKey && {
              envVars: { ANTHROPIC_API_KEY: anthropicApiKey },
            }),
        })

        // For Claude Max, write stored credentials so the Agent SDK picks them up
        if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
          const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
          await sandbox.process.executeCommand(
            `mkdir -p ${PATHS.CLAUDE_CREDENTIALS_DIR} && echo '${credentialsB64}' | base64 -d > ${PATHS.CLAUDE_CREDENTIALS_FILE} && chmod 600 ${PATHS.CLAUDE_CREDENTIALS_FILE}`
          )
        }

        sendProgress(controller, "Cloning repository...")

        // Use Daytona SDK git interface
        const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
        const cloneUrl = `https://github.com/${repoOwner}/${repoName}.git`
        const base = baseBranch || "main"
        await sandbox.git.clone(
          cloneUrl,
          repoPath,
          base,
          undefined,
          "x-access-token",
          githubToken
        )

        // Set up git author config from GitHub user
        let gitName = "Sandboxed Agent"
        let gitEmail = "noreply@example.com"
        try {
          const ghRes = await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github.v3+json",
            },
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
        sendProgress(controller, `Creating branch ${newBranch} from ${base}...`)
        await sandbox.git.createBranch(repoPath, newBranch)
        await sandbox.git.checkoutBranch(repoPath, newBranch)

        // If starting from a specific commit, reset to it
        if (startCommit) {
          sendProgress(controller, `Resetting to commit ${startCommit.slice(0, 7)}...`)
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

        sendProgress(controller, "Preparing agent environment...")

        // Get preview URL pattern for dev server URLs
        let previewUrlPattern: string | undefined
        try {
          const previewLink = await sandbox.getPreviewLink(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT)
          previewUrlPattern = previewLink.url.replace(String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT), "{port}")
        } catch {
          // Preview URLs not available — non-critical
        }

        // Note: The SDK handles Claude CLI installation automatically when
        // createAgentSession is called. We don't need to do any Python setup here.

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

        // Create branch record with appropriate default agent based on credentials
        branchRecord = await prisma.branch.create({
          data: {
            repoId: dbRepo.id,
            name: newBranch,
            baseBranch: baseBranch || "main",
            startCommit: headCommit, // Store the HEAD commit for commit detection baseline
            status: "idle",
            agent: defaultAgent,
          },
        })

        // Create sandbox record (no contextId needed - SDK handles sessions natively)
        sandboxRecord = await prisma.sandbox.create({
          data: {
            sandboxId: sandbox.id,
            sandboxName,
            userId: userId,
            branchId: branchRecord.id,
            previewUrlPattern,
            status: "running",
          },
        })

        sendDone(controller, {
          sandboxId: sandbox.id,
          previewUrlPattern,
          branchId: branchRecord.id,
          repoId: dbRepo.id,
          startCommit: headCommit,
          agent: defaultAgent,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        sendError(controller, message)

        // Clean up database records if created
        if (sandboxRecord) {
          await prisma.sandbox.delete({ where: { id: sandboxRecord.id } }).catch(() => {})
        }
        if (branchRecord) {
          await prisma.branch.delete({ where: { id: branchRecord.id } }).catch(() => {})
        }
      }
    },
  })
}
