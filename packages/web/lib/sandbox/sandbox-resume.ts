import { Daytona, DaytonaNotFoundError } from "@daytonaio/sdk"
import { readPersistedSessionId } from "@/lib/agents/agent-session"
import { PATHS, SANDBOX_CONFIG } from "@/lib/shared/constants"
import { prisma } from "@/lib/db/prisma"
import { buildMcpConfig, getMcpConfigWriteCommand } from "@/lib/mcp/mcp-config"
import { decrypt } from "@/lib/auth/encryption"
import type { Agent } from "@/lib/shared/types"
import { setupClaudeHooks } from "@/lib/agents/claude-hooks"
import { OPENCODE_PERMISSION_ENV } from "@/lib/agents/opencode-permissions"
import { setupCodexRules } from "@/lib/agents/codex-rules"

/**
 * Error thrown when a sandbox is not found in Daytona but exists in the database.
 * This indicates the sandbox was deleted externally and needs to be recreated.
 */
export class SandboxNotFoundError extends Error {
  constructor(public sandboxId: string) {
    super(`Sandbox ${sandboxId} not found in Daytona - it may have been deleted`)
    this.name = "SandboxNotFoundError"
  }
}

/**
 * Decrypts repo-level environment variables.
 * Returns empty object if no env vars or decryption fails.
 */
async function getRepoEnvVars(repoId?: string): Promise<Record<string, string>> {
  if (!repoId) return {}

  try {
    const repo = await prisma.repo.findUnique({
      where: { id: repoId },
      select: { envVars: true },
    })

    if (!repo?.envVars) return {}

    const encryptedEnvVars = repo.envVars as Record<string, string>
    const decryptedEnvVars: Record<string, string> = {}

    for (const [key, encryptedValue] of Object.entries(encryptedEnvVars)) {
      try {
        decryptedEnvVars[key] = decrypt(encryptedValue)
      } catch {
        // Skip keys that fail to decrypt
        console.warn(`[getRepoEnvVars] Failed to decrypt env var: ${key}`)
      }
    }

    return decryptedEnvVars
  } catch (err) {
    console.error("[getRepoEnvVars] Failed to fetch repo env vars:", err)
    return {}
  }
}

/**
 * Determines which API key(s) to inject based on agent type and selected model.
 * Returns environment variables appropriate for the model provider.
 */
function getEnvForModel(
  model: string | undefined,
  agent: Agent | undefined,
  credentials: {
    anthropicApiKey?: string
    anthropicAuthToken?: string
    openaiApiKey?: string
    opencodeApiKey?: string
    geminiApiKey?: string
  }
): Record<string, string> {
  const env: Record<string, string> = {}

  // For Claude Code agent: use API key only if not using auth token (credentials file)
  if (agent === "claude-code" || !agent) {
    if (!credentials.anthropicAuthToken && credentials.anthropicApiKey) {
      env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
    }
    return env
  }

  // For Codex agent: use OpenAI API key
  if (agent === "codex") {
    if (credentials.openaiApiKey) {
      env.OPENAI_API_KEY = credentials.openaiApiKey
    }
    return env
  }

  // For Gemini agent: use Gemini API key
  if (agent === "gemini") {
    if (credentials.geminiApiKey) {
      env.GEMINI_API_KEY = credentials.geminiApiKey
    }
    return env
  }

  // For OpenCode agent, determine API key based on model prefix
  if (agent === "opencode") {
    const modelPrefix = model?.split("/")[0]

    if (modelPrefix === "anthropic") {
      // anthropic/* models use Anthropic API key directly
      if (credentials.anthropicApiKey) {
        env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
      }
    } else if (modelPrefix === "openai") {
      // openai/* models use OpenAI API key directly
      if (credentials.openaiApiKey) {
        env.OPENAI_API_KEY = credentials.openaiApiKey
      }
    } else if (modelPrefix === "opencode") {
      // opencode/* models - free ones don't need a key, paid ones use OpenCode API key
      const isFreeModel = model?.includes("-free") || model === "opencode/big-pickle"
      if (!isFreeModel && credentials.opencodeApiKey) {
        env.OPENCODE_API_KEY = credentials.opencodeApiKey
      }
    }
  }

  return env
}

/**
 * Ensures a sandbox is running and ready for agent execution.
 * If the sandbox was stopped, it restarts it and sets up credentials.
 * The SDK handles CLI installation automatically when creating a session.
 */
export async function ensureSandboxReady(
  daytonaApiKey: string,
  sandboxId: string,
  repoName: string,
  previewUrlPattern?: string,
  anthropicApiKey?: string,
  anthropicAuthType?: string,
  anthropicAuthToken?: string,
  // Database session ID - this is the source of truth since it persists across sandbox rebuilds
  databaseSessionId?: string,
  // Agent that created the stored session; when different from current agent, we start a new session
  databaseSessionAgent?: string,
  // OpenAI API key for Codex and OpenCode agents
  openaiApiKey?: string,
  // Agent type to determine which credentials to include
  agent?: Agent,
  // Model selection for determining which API key to use
  model?: string,
  // OpenCode API key for OpenCode paid models
  opencodeApiKey?: string,
  // Repository ID for fetching MCP server configs
  repoId?: string,
  // Gemini API key for Gemini agent
  geminiApiKey?: string
): Promise<{
  sandbox: Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>
  wasResumed: boolean
  resumeSessionId?: string
  env: Record<string, string>
}> {
  let t0 = Date.now()
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  let sandbox
  try {
    sandbox = await daytona.get(sandboxId)
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) {
      console.log(`[ensureSandboxReady] Sandbox ${sandboxId} not found in Daytona`)
      throw new SandboxNotFoundError(sandboxId)
    }
    throw error
  }
  console.log(`[ensureSandboxReady] daytona.get took ${Date.now() - t0}ms`)

  // Start sandbox if not running
  if (sandbox.state !== "started") {
    t0 = Date.now()
    await sandbox.start(SANDBOX_CONFIG.START_TIMEOUT_SECONDS)
    console.log(`[ensureSandboxReady] sandbox.start took ${Date.now() - t0}ms`)
  }

  // Read stored session ID for agent resumption
  // Priority: file (latest conversation session, used by SDK) > database (fallback)
  // When the user has changed agent, we always start with a blank session (OpenCode expects "ses..." or unset)
  t0 = Date.now()
  const fileSessionId = await readPersistedSessionId(sandbox)
  console.log(`[ensureSandboxReady] readPersistedSessionId took ${Date.now() - t0}ms`)
  const sameAgent = !databaseSessionAgent || databaseSessionAgent === agent
  const resumeSessionId =
    sameAgent ? (fileSessionId || databaseSessionId) : undefined

  // Write Claude credentials file on every prompt execution
  // This ensures fresh credentials are always available to the Claude Agent SDK
  if (anthropicAuthToken) {
    t0 = Date.now()
    const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
    await sandbox.process.executeCommand(
      `mkdir -p ${PATHS.CLAUDE_CREDENTIALS_DIR} && echo '${credentialsB64}' | base64 -d > ${PATHS.CLAUDE_CREDENTIALS_FILE} && chmod 600 ${PATHS.CLAUDE_CREDENTIALS_FILE}`
    )
    console.log(`[ensureSandboxReady] claude credentials written, took ${Date.now() - t0}ms`)
  }

  // Set up Claude Code hooks on every resume to ensure they're always present
  // This handles cases where hooks may have been removed or sandbox was rebuilt
  if (agent === "claude-code" || !agent) {
    t0 = Date.now()
    await setupClaudeHooks(sandbox)
    console.log(`[ensureSandboxReady] claude hooks written, took ${Date.now() - t0}ms`)
  }

  // NOTE: OpenCode permissions are NOT written to the config file.
  // They are passed via OPENCODE_PERMISSION env var (see below) because the SDK
  // sets OPENCODE_PERMISSION='{"*":"allow"}' by default, which overrides config file permissions.

  // Set up Codex rules on every resume to ensure they're always present
  if (agent === "codex") {
    t0 = Date.now()
    await setupCodexRules(sandbox)
    console.log(`[ensureSandboxReady] codex rules written, took ${Date.now() - t0}ms`)
  }

  // Write MCP server configurations if any are configured for this repo
  // NOTE: OpenCode MCP config writing is currently disabled.
  if (repoId && agent && agent !== "opencode") {
    t0 = Date.now()
    try {
      const mcpServers = await prisma.repoMcpServer.findMany({
        where: { repoId, status: "connected" },
        select: {
          slug: true,
          name: true,
          url: true,
          accessToken: true,
          refreshToken: true,
        },
      })

      if (mcpServers.length > 0) {
        const { configPath, configContent, configDir } = buildMcpConfig(mcpServers, agent)
        if (configContent) {
          const mcpCommand = getMcpConfigWriteCommand(configDir, configPath, configContent, agent)
          await sandbox.process.executeCommand(mcpCommand)
          console.log(`[ensureSandboxReady] MCP config (${mcpServers.length} servers) took ${Date.now() - t0}ms`)
        }
      }
    } catch (err) {
      // Non-critical - log but don't fail the sandbox startup
      console.error("[ensureSandboxReady] Failed to write MCP config:", err)
    }
  }

  // Get environment variables based on model and agent (API keys)
  const apiKeyEnv = getEnvForModel(model, agent, {
    anthropicApiKey,
    anthropicAuthToken,
    openaiApiKey,
    opencodeApiKey,
    geminiApiKey,
  })

  // Get user-provided repo-level env vars (decrypted)
  const repoEnv = await getRepoEnvVars(repoId)

  // Merge: repo env vars first, then API keys (API keys take precedence if same key)
  const env: Record<string, string> = { ...repoEnv, ...apiKeyEnv }

  // For OpenCode, pass permissions via env var (NOT config file - see opencode-permissions.ts for why)
  // OPENCODE_PERMISSION overrides the SDK's default '{"*":"allow"}' that bypasses all permissions
  if (agent === "opencode") {
    env.OPENCODE_PERMISSION = OPENCODE_PERMISSION_ENV
  }

  return {
    sandbox,
    wasResumed: !!resumeSessionId,
    resumeSessionId,
    env,
  }
}

/**
 * Lighter version — just ensures a sandbox is running.
 * Used for git/SSH operations that don't need the agent context.
 */
export async function ensureSandboxStarted(
  daytonaApiKey: string,
  sandboxId: string
): Promise<Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>> {
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  let sandbox
  try {
    sandbox = await daytona.get(sandboxId)
  } catch (error) {
    if (error instanceof DaytonaNotFoundError) {
      console.log(`[ensureSandboxStarted] Sandbox ${sandboxId} not found in Daytona`)
      throw new SandboxNotFoundError(sandboxId)
    }
    throw error
  }

  if (sandbox.state !== "started") {
    await sandbox.start(SANDBOX_CONFIG.START_TIMEOUT_SECONDS)
  }

  return sandbox
}
