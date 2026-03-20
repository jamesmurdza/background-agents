import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/prisma"
import { generateSandboxName } from "@/lib/sandbox-utils"
import { SANDBOX_CONFIG, PATHS } from "@/lib/constants"
import { logActivity } from "@/lib/activity-log"
import { decrypt } from "@/lib/encryption"
import type { SandboxWithCredentials, DecryptedCredentials } from "@/lib/api-helpers"

/**
 * Checks if an error indicates the sandbox was not found in Daytona.
 * This handles various error formats from the Daytona SDK.
 */
export function isSandboxNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return (
    message.includes("not found") ||
    message.includes("404") ||
    message.includes("does not exist") ||
    message.includes("no such sandbox") ||
    message.includes("sandbox not found")
  )
}

export interface RecreationResult {
  sandbox: Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>
  wasRecreated: boolean
  newSandboxId?: string
  error?: string
}

export interface RecreationContext {
  daytonaApiKey: string
  sandboxRecord: SandboxWithCredentials
  githubToken: string
  userCredentials: DecryptedCredentials
  userId: string
}

/**
 * Attempts to get an existing sandbox, or recreates it if the cloud sandbox
 * has been deleted but the DB record still exists.
 *
 * This handles the case where:
 * 1. User has a branch with a sandbox record in our DB
 * 2. The actual Daytona sandbox was deleted (manually, GC, etc.)
 * 3. User tries to use the branch again
 *
 * Recreation process:
 * 1. Detect sandbox not found error from Daytona SDK
 * 2. Create a new Daytona sandbox
 * 3. Clone the repository
 * 4. Checkout the branch (create if needed, since remote may not have it)
 * 5. Update the DB record with the new sandbox ID
 */
export async function getOrRecreateSandbox(
  context: RecreationContext
): Promise<RecreationResult> {
  const { daytonaApiKey, sandboxRecord, githubToken, userCredentials, userId } = context

  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const originalSandboxId = sandboxRecord.sandboxId

  try {
    // Try to get the existing sandbox
    const sandbox = await daytona.get(originalSandboxId)
    return { sandbox, wasRecreated: false }
  } catch (error) {
    // If it's not a "not found" error, rethrow
    if (!isSandboxNotFoundError(error)) {
      throw error
    }

    console.log(
      `[sandbox-recreate] Sandbox ${originalSandboxId} not found in Daytona, recreating...`
    )

    // Sandbox not found - recreate it
    return recreateSandbox(context, daytona, originalSandboxId)
  }
}

/**
 * Recreates a sandbox that was deleted in Daytona but still has a DB record.
 * This mirrors the logic in /api/sandbox/create but updates existing records.
 */
async function recreateSandbox(
  context: RecreationContext,
  daytona: Daytona,
  originalSandboxId: string
): Promise<RecreationResult> {
  const { sandboxRecord, githubToken, userCredentials, userId } = context

  const branch = sandboxRecord.branch
  if (!branch) {
    throw new Error("Cannot recreate sandbox: branch record not found")
  }

  const repo = branch.repo
  if (!repo) {
    throw new Error("Cannot recreate sandbox: repo record not found")
  }

  const repoOwner = repo.owner
  const repoName = repo.name
  const branchName = branch.name

  // Fetch the full branch record to get baseBranch and startCommit
  const fullBranch = await prisma.branch.findUnique({
    where: { id: branch.id },
    select: {
      baseBranch: true,
      startCommit: true,
    },
  })

  const baseBranch = fullBranch?.baseBranch || "main"

  // Get user's auto-stop interval preference
  const userCreds = await prisma.userCredentials.findUnique({
    where: { userId },
    select: { sandboxAutoStopInterval: true },
  })
  const sandboxAutoStopInterval = userCreds?.sandboxAutoStopInterval ?? 5

  // Fetch repo env vars
  let repoEnvVars: Record<string, string> = {}
  const repoRecord = await prisma.repo.findUnique({
    where: { id: repo.id },
    select: { envVars: true },
  })
  if (repoRecord?.envVars) {
    const encryptedEnvVars = repoRecord.envVars as Record<string, string>
    for (const [key, encryptedValue] of Object.entries(encryptedEnvVars)) {
      try {
        repoEnvVars[key] = decrypt(encryptedValue)
      } catch {
        // Skip keys that fail to decrypt
      }
    }
  }

  // Build env vars
  const sandboxEnvVars: Record<string, string> = { ...repoEnvVars }
  if (userCredentials.anthropicAuthType !== "claude-max" && userCredentials.anthropicApiKey) {
    sandboxEnvVars.ANTHROPIC_API_KEY = userCredentials.anthropicApiKey
  }

  // Create new Daytona sandbox
  const sandboxName = generateSandboxName(userId)
  console.log(`[sandbox-recreate] Creating new sandbox: ${sandboxName}`)

  const sandbox = await daytona.create({
    name: sandboxName,
    snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
    autoStopInterval: sandboxAutoStopInterval,
    public: true,
    labels: {
      [SANDBOX_CONFIG.LABEL_KEY]: "true",
      repo: `${repoOwner}/${repoName}`,
      branch: branchName,
      userId: userId,
    },
    ...(Object.keys(sandboxEnvVars).length > 0 && {
      envVars: sandboxEnvVars,
    }),
  })

  const newSandboxId = sandbox.id
  console.log(`[sandbox-recreate] New sandbox created: ${newSandboxId}`)

  try {
    // Write Claude Max credentials if needed
    if (userCredentials.anthropicAuthType === "claude-max" && userCredentials.anthropicAuthToken) {
      const credentialsB64 = Buffer.from(userCredentials.anthropicAuthToken).toString("base64")
      await sandbox.process.executeCommand(
        `mkdir -p ${PATHS.CLAUDE_CREDENTIALS_DIR} && echo '${credentialsB64}' | base64 -d > ${PATHS.CLAUDE_CREDENTIALS_FILE} && chmod 600 ${PATHS.CLAUDE_CREDENTIALS_FILE}`
      )
    }

    // Clone the repository
    console.log(`[sandbox-recreate] Cloning ${repoOwner}/${repoName}...`)
    const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`
    const cloneUrl = `https://github.com/${repoOwner}/${repoName}.git`

    await sandbox.git.clone(
      cloneUrl,
      repoPath,
      baseBranch,
      undefined,
      "x-access-token",
      githubToken
    )

    // Set up git author config
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
    } catch {
      // Use defaults
    }
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git config user.email "${gitEmail}" && git config user.name "${gitName}"`
    )

    // Try to checkout the existing branch, or create it if it doesn't exist
    console.log(`[sandbox-recreate] Checking out branch ${branchName}...`)

    // First, try to fetch the branch from remote (in case it was pushed before)
    const authedUrl = cloneUrl.replace(
      /^https:\/\//,
      `https://x-access-token:${githubToken}@`
    )

    // Try to fetch the remote branch
    const fetchResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git fetch ${authedUrl} ${branchName}:${branchName} 2>&1 || true`
    )
    console.log(`[sandbox-recreate] Fetch result: ${fetchResult.result}`)

    // Check if the branch exists locally now
    const branchExistsResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git show-ref --verify --quiet refs/heads/${branchName} && echo "exists" || echo "not_exists"`
    )

    if (branchExistsResult.result.trim() === "exists") {
      // Branch exists, just checkout
      await sandbox.git.checkoutBranch(repoPath, branchName)
    } else {
      // Branch doesn't exist, create it
      await sandbox.git.createBranch(repoPath, branchName)
      await sandbox.git.checkoutBranch(repoPath, branchName)
    }

    // If we have a startCommit, try to reset to it
    if (fullBranch?.startCommit) {
      console.log(`[sandbox-recreate] Resetting to start commit ${fullBranch.startCommit}...`)
      // Fetch the specific commit in case it's not in the current history
      await sandbox.process.executeCommand(
        `cd ${repoPath} && git fetch ${authedUrl} ${fullBranch.startCommit} 2>&1 || true`
      )
      const resetResult = await sandbox.process.executeCommand(
        `cd ${repoPath} && git reset --hard ${fullBranch.startCommit} 2>&1`
      )
      if (resetResult.exitCode) {
        console.warn(
          `[sandbox-recreate] Could not reset to ${fullBranch.startCommit}: ${resetResult.result}`
        )
        // Continue anyway - we're on the branch, just not at the exact commit
      }
    }

    // Get new preview URL pattern
    let previewUrlPattern: string | undefined
    try {
      const previewLink = await sandbox.getPreviewLink(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT)
      previewUrlPattern = previewLink.url.replace(String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT), "{port}")
    } catch {
      // Preview URLs not available — non-critical
    }

    // Update the sandbox record with the new sandbox ID
    await prisma.sandbox.update({
      where: { id: sandboxRecord.id },
      data: {
        sandboxId: newSandboxId,
        sandboxName,
        previewUrlPattern,
        status: "running",
        sessionId: null, // Clear session since it's a new sandbox
        sessionAgent: null,
        lastActiveAt: new Date(),
      },
    })

    // Log the recreation for metrics
    logActivity(userId, "sandbox_recreated", {
      oldSandboxId: originalSandboxId,
      newSandboxId,
      repoOwner,
      repoName,
      branchName,
      reason: "cloud_sandbox_not_found",
    })

    console.log(
      `[sandbox-recreate] Successfully recreated sandbox. Old: ${originalSandboxId}, New: ${newSandboxId}`
    )

    return {
      sandbox,
      wasRecreated: true,
      newSandboxId,
    }
  } catch (error) {
    // If recreation failed after creating the sandbox, clean it up
    console.error(`[sandbox-recreate] Recreation failed, cleaning up sandbox ${newSandboxId}:`, error)
    try {
      await sandbox.delete()
    } catch (cleanupError) {
      console.warn(`[sandbox-recreate] Failed to cleanup sandbox after error:`, cleanupError)
    }
    throw error
  }
}
