import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import { checkDuplicateBranchName } from "@/lib/db/branch-helpers"
import { checkQuota } from "@/lib/sandbox/quota"
import { generateSandboxName } from "@/lib/sandbox/sandbox-utils"
import {
  requireAuth,
  isAuthError,
  getDaytonaApiKey,
  isDaytonaKeyError,
  badRequest,
  unauthorized,
  resolveUserCredentials,
  getGitHubTokenForUser,
} from "@/lib/shared/api-helpers"
import { createSSEStream, sendProgress, sendError, sendDone } from "@/lib/llm/streaming-helpers"
import { SANDBOX_CONFIG, PATHS } from "@/lib/shared/constants"
import { getDefaultAgent } from "@/lib/shared/types"
import { cleanupDaytonaSandbox } from "@/lib/sandbox/daytona-cleanup"
import { decrypt } from "@/lib/auth/encryption"
import { logActivity } from "@/lib/shared/activity-log"

// Sandbox creation timeout - 300 seconds (must be literal for Next.js static analysis)
export const maxDuration = 300

export async function POST(req: Request) {
  // 1. Authenticate
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const body = await req.json()
  const { repoId, repoOwner, repoName, baseBranch, newBranch, startCommit, existingBranchId } = body

  // For recreation, we need existingBranchId; for new branches, we need the standard fields
  if (existingBranchId) {
    // Recreation mode - we'll fetch branch info from DB
  } else if (!repoOwner || !repoName || !newBranch) {
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
  const githubToken = await getGitHubTokenForUser(userId)
  if (!githubToken) {
    return unauthorized()
  }

  // Get user's Anthropic credentials
  const userCredentials = await prisma.userCredentials.findUnique({
    where: { userId },
  })

  const { anthropicApiKey, anthropicAuthToken, anthropicAuthType } =
    await resolveUserCredentials(userCredentials, userId)
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

  // For recreation mode, fetch the existing branch and its repo
  let existingBranch: {
    id: string
    name: string
    baseBranch: string | null
    agent: string
    repo: { id: string; owner: string; name: string }
  } | null = null

  if (existingBranchId) {
    existingBranch = await prisma.branch.findFirst({
      where: { id: existingBranchId, repo: { userId } },
      select: {
        id: true,
        name: true,
        baseBranch: true,
        agent: true,
        repo: { select: { id: true, owner: true, name: true } },
      },
    })
    if (!existingBranch) {
      return badRequest("Branch not found or doesn't belong to user")
    }
  }

  // Use existing branch info for recreation, or request params for new branch
  const effectiveRepoOwner = existingBranch?.repo.owner ?? repoOwner
  const effectiveRepoName = existingBranch?.repo.name ?? repoName
  const effectiveBranchName = existingBranch?.name ?? newBranch
  const effectiveBaseBranch = existingBranch?.baseBranch ?? baseBranch ?? "main"
  const effectiveRepoId = existingBranch?.repo.id ?? repoId
  const isRecreation = !!existingBranch

  // Track records for cleanup on error
  let sandboxRecord: { id: string; sandboxId: string } | null = null
  let branchRecord: { id: string } | null = null
  let daytonaClient: Daytona | null = null
  let daytonaSandboxId: string | null = null

  return createSSEStream({
    onStart: async (controller) => {
      try {
        sendProgress(controller, isRecreation ? "Recreating sandbox..." : "Creating sandbox...")

        daytonaClient = new Daytona({ apiKey: daytonaApiKey })
        const sandboxName = generateSandboxName(userId)

        // Repo env vars: from DB (encrypted). Prefer repoId when provided (must belong to user);
        // otherwise resolve by owner/name so clients that omit repoId still get vars.
        let repoEnvVars: Record<string, string> = {}
        const repoForEnv = effectiveRepoId
          ? await prisma.repo.findFirst({
              where: { id: effectiveRepoId, userId },
              select: { envVars: true },
            })
          : await prisma.repo.findUnique({
              where: {
                userId_owner_name: { userId, owner: effectiveRepoOwner, name: effectiveRepoName },
              },
              select: { envVars: true },
            })
        if (repoForEnv?.envVars) {
          const encryptedEnvVars = repoForEnv.envVars as Record<string, string>
          for (const [key, encryptedValue] of Object.entries(encryptedEnvVars)) {
            try {
              repoEnvVars[key] = decrypt(encryptedValue)
            } catch {
              // Skip keys that fail to decrypt
            }
          }
        }

        // Build env vars: repo env vars + Anthropic API key (if applicable)
        const sandboxEnvVars: Record<string, string> = { ...repoEnvVars }
        if (anthropicAuthType !== "claude-max" && anthropicApiKey) {
          sandboxEnvVars.ANTHROPIC_API_KEY = anthropicApiKey
        }

        // Only inject Anthropic API key if using claude-code agent or opencode with Anthropic models
        // For opencode with free models, no API key is needed
        const sandbox = await daytonaClient.create({
          name: sandboxName,
          snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
          autoStopInterval: sandboxAutoStopInterval,
          public: true,
          labels: {
            [SANDBOX_CONFIG.LABEL_KEY]: "true",
            repo: `${effectiveRepoOwner}/${effectiveRepoName}`,
            branch: effectiveBranchName,
            userId: userId,
          },
          ...(Object.keys(sandboxEnvVars).length > 0 && {
            envVars: sandboxEnvVars,
          }),
        })

        // Track sandbox ID for cleanup if subsequent steps fail
        daytonaSandboxId = sandbox.id

        // Write Claude credentials so the Agent SDK picks them up
        if (anthropicAuthToken) {
          const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
          await sandbox.process.executeCommand(
            `mkdir -p ${PATHS.CLAUDE_CREDENTIALS_DIR} && echo '${credentialsB64}' | base64 -d > ${PATHS.CLAUDE_CREDENTIALS_FILE} && chmod 600 ${PATHS.CLAUDE_CREDENTIALS_FILE}`
          )
        }

        // Create the logs directory for agent output
        await sandbox.process.executeCommand(`mkdir -p ${PATHS.LOGS_DIR}`)

        // Note: Agent-specific rules (Claude hooks, OpenCode permissions, Codex rules)
        // are set up in ensureSandboxReady() right before each agent execution

        sendProgress(controller, "Cloning repository...")

        // Use Daytona SDK git interface
        const repoPath = `${PATHS.SANDBOX_HOME}/${effectiveRepoName}`
        const cloneUrl = `https://github.com/${effectiveRepoOwner}/${effectiveRepoName}.git`
        await sandbox.git.clone(
          cloneUrl,
          repoPath,
          effectiveBaseBranch,
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

        // Create marker file after clone completes - used as baseline for modified file detection
        await sandbox.process.executeCommand(`touch ${PATHS.CLONE_MARKER_FILE}`)

        // For recreation: try to fetch and checkout the existing branch from remote
        // For new branch: create it from base
        const authedUrl = cloneUrl.replace(
          /^https:\/\//,
          `https://x-access-token:${githubToken}@`
        )

        if (isRecreation) {
          sendProgress(controller, `Checking out branch ${effectiveBranchName}...`)
          // Try to fetch the branch from remote (may have been pushed before deletion)
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git fetch ${authedUrl} ${effectiveBranchName}:${effectiveBranchName} 2>&1 || true`
          )
          // Check if branch exists locally now
          const branchExistsResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git show-ref --verify --quiet refs/heads/${effectiveBranchName} && echo "exists" || echo "not_exists"`
          )
          if (branchExistsResult.result.trim() === "exists") {
            await sandbox.git.checkoutBranch(repoPath, effectiveBranchName)
          } else {
            // Branch doesn't exist on remote, create it fresh from base
            await sandbox.git.createBranch(repoPath, effectiveBranchName)
            await sandbox.git.checkoutBranch(repoPath, effectiveBranchName)
          }
        } else {
          sendProgress(controller, `Creating branch ${effectiveBranchName} from ${effectiveBaseBranch}...`)
          await sandbox.git.createBranch(repoPath, effectiveBranchName)
          await sandbox.git.checkoutBranch(repoPath, effectiveBranchName)
        }

        // If starting from a specific commit (new branch only), fetch it and reset to it
        if (startCommit && !isRecreation) {
          sendProgress(controller, `Resetting to commit ${startCommit.slice(0, 7)}...`)
          // Fetch the specific commit in case it's not part of the cloned branch history
          // This handles the case where user branches from a commit that exists on a different branch
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git fetch ${authedUrl} ${startCommit} 2>&1`
          )
          const resetResult = await sandbox.process.executeCommand(
            `cd ${repoPath} && git reset --hard ${startCommit} 2>&1`
          )
          if (resetResult.exitCode) {
            throw new Error(`Failed to reset to commit ${startCommit.slice(0, 7)}: ${resetResult.result}`)
          }
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

        let finalBranchId: string
        let finalRepoId: string
        let finalAgent: string

        if (isRecreation && existingBranch) {
          // Recreation mode: use existing branch, just create sandbox record
          finalBranchId = existingBranch.id
          finalRepoId = existingBranch.repo.id
          finalAgent = existingBranch.agent

          // Create sandbox record linked to existing branch
          sandboxRecord = await prisma.sandbox.create({
            data: {
              sandboxId: sandbox.id,
              sandboxName,
              userId: userId,
              branchId: finalBranchId,
              previewUrlPattern,
              status: "running",
            },
          })

          // Log recreation activity
          logActivity(userId, "sandbox_created", {
            repoOwner: effectiveRepoOwner,
            repoName: effectiveRepoName,
            branchName: effectiveBranchName,
            sandboxId: sandbox.id,
            agent: finalAgent,
            isRecreation: true,
          })
        } else {
          // New branch mode: create repo (if needed), branch, and sandbox records
          let dbRepo = await prisma.repo.findUnique({
            where: {
              userId_owner_name: {
                userId: userId,
                owner: effectiveRepoOwner,
                name: effectiveRepoName,
              },
            },
          })

          if (!dbRepo && effectiveRepoId) {
            dbRepo = await prisma.repo.findUnique({
              where: { id: effectiveRepoId },
            })
          }

          if (!dbRepo) {
            // Create repo if it doesn't exist
            dbRepo = await prisma.repo.create({
              data: {
                userId: userId,
                owner: effectiveRepoOwner,
                name: effectiveRepoName,
                defaultBranch: effectiveBaseBranch,
              },
            })
          }

          // Check if branch with this name already exists in this repo
          const duplicateCheck = await checkDuplicateBranchName(dbRepo.id, effectiveBranchName)
          if (duplicateCheck) {
            throw new Error(duplicateCheck.error)
          }

          // Create branch record with appropriate default agent based on credentials
          branchRecord = await prisma.branch.create({
            data: {
              repoId: dbRepo.id,
              name: effectiveBranchName,
              baseBranch: effectiveBaseBranch,
              startCommit: headCommit, // Store the HEAD commit for commit detection baseline
              status: "idle",
              agent: defaultAgent,
            },
          })

          finalBranchId = branchRecord.id
          finalRepoId = dbRepo.id
          finalAgent = defaultAgent

          // Create sandbox record
          sandboxRecord = await prisma.sandbox.create({
            data: {
              sandboxId: sandbox.id,
              sandboxName,
              userId: userId,
              branchId: finalBranchId,
              previewUrlPattern,
              status: "running",
            },
          })

          // Log activity for metrics
          logActivity(userId, "sandbox_created", {
            repoOwner: effectiveRepoOwner,
            repoName: effectiveRepoName,
            branchName: effectiveBranchName,
            sandboxId: sandbox.id,
            agent: finalAgent,
          })
        }

        sendDone(controller, {
          sandboxId: sandbox.id,
          previewUrlPattern,
          branchId: finalBranchId,
          repoId: finalRepoId,
          startCommit: headCommit,
          agent: finalAgent,
          isRecreation,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        console.error(`[sandbox/create] Error creating sandbox: ${message}`)
        sendError(controller, message)

        // Clean up in reverse order of creation:
        // 1. Database sandbox record
        // 2. Database branch record
        // 3. Daytona cloud sandbox (if created but DB records failed)

        if (sandboxRecord) {
          await prisma.sandbox.delete({ where: { id: sandboxRecord.id } }).catch((err: unknown) => {
            console.warn(`[sandbox/create] Failed to cleanup sandbox record: ${err}`)
          })
        }
        if (branchRecord) {
          await prisma.branch.delete({ where: { id: branchRecord.id } }).catch((err: unknown) => {
            console.warn(`[sandbox/create] Failed to cleanup branch record: ${err}`)
          })
        }

        // Clean up Daytona cloud sandbox if it was created but subsequent steps failed
        // This prevents orphaned cloud resources
        if (daytonaSandboxId && daytonaClient) {
          await cleanupDaytonaSandbox(daytonaClient, daytonaSandboxId)
        }
      }
    },
  })
}
