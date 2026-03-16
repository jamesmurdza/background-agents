import { Daytona } from "@daytonaio/sdk"
import { readPersistedSessionId } from "@/lib/agent-session"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import type { Agent } from "@/lib/types"

/**
 * Determines which API key(s) to inject based on agent type and selected model.
 * Returns environment variables appropriate for the model provider.
 */
function getEnvForModel(
  model: string | undefined,
  agent: Agent | undefined,
  credentials: {
    anthropicApiKey?: string
    anthropicAuthType?: string
    openaiApiKey?: string
    openrouterApiKey?: string
  }
): Record<string, string> {
  const env: Record<string, string> = {}

  // For Claude Code agent, always use Anthropic credentials
  if (agent === "claude-code" || !agent) {
    if (credentials.anthropicAuthType !== "claude-max" && credentials.anthropicApiKey) {
      env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
    }
    return env
  }

  // For Codex agent, always use OpenAI credentials
  if (agent === "codex") {
    if (credentials.openaiApiKey) {
      env.OPENAI_API_KEY = credentials.openaiApiKey
    }
    return env
  }

  // For OpenCode agent, select API key based on model prefix
  if (agent === "opencode") {
    // Parse the model string to determine provider
    // Model formats:
    // - "anthropic/claude-..." -> Anthropic API key needed
    // - "openai/gpt-..." -> OpenAI API key needed
    // - "openrouter/..." -> Free models, no API key needed (uses OpenRouter's free tier)
    // - "google/..." -> OpenRouter API key needed

    const modelPrefix = model?.split("/")[0]?.toLowerCase()

    if (modelPrefix === "anthropic") {
      if (credentials.anthropicApiKey) {
        env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
      }
    } else if (modelPrefix === "openai") {
      if (credentials.openaiApiKey) {
        env.OPENAI_API_KEY = credentials.openaiApiKey
      }
    } else if (modelPrefix === "openrouter") {
      // Free models via OpenRouter - no API key needed for free tier models
      // If user has an OpenRouter key, include it for potential rate limit benefits
      if (credentials.openrouterApiKey) {
        env.OPENROUTER_API_KEY = credentials.openrouterApiKey
      }
    } else if (modelPrefix === "google") {
      // Google models via OpenRouter
      if (credentials.openrouterApiKey) {
        env.OPENROUTER_API_KEY = credentials.openrouterApiKey
      }
    } else {
      // Unknown provider - include all available keys for flexibility
      if (credentials.openrouterApiKey) {
        env.OPENROUTER_API_KEY = credentials.openrouterApiKey
      }
      if (credentials.openaiApiKey) {
        env.OPENAI_API_KEY = credentials.openaiApiKey
      }
      if (credentials.anthropicApiKey) {
        env.ANTHROPIC_API_KEY = credentials.anthropicApiKey
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
  // OpenRouter API key for OpenRouter models
  openrouterApiKey?: string
): Promise<{
  sandbox: Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>
  wasResumed: boolean
  resumeSessionId?: string
  env: Record<string, string>
}> {
  let t0 = Date.now()
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(sandboxId)
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

  // For Claude Max, write credentials if needed
  if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
    t0 = Date.now()
    const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
    await sandbox.process.executeCommand(
      `mkdir -p ${PATHS.CLAUDE_CREDENTIALS_DIR} && echo '${credentialsB64}' | base64 -d > ${PATHS.CLAUDE_CREDENTIALS_FILE} && chmod 600 ${PATHS.CLAUDE_CREDENTIALS_FILE}`
    )
    console.log(`[ensureSandboxReady] claude-max credentials took ${Date.now() - t0}ms`)
  }

  // Get environment variables based on model and agent
  const env = getEnvForModel(model, agent, {
    anthropicApiKey,
    anthropicAuthType,
    openaiApiKey,
    openrouterApiKey,
  })

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
  const sandbox = await daytona.get(sandboxId)

  if (sandbox.state !== "started") {
    await sandbox.start(SANDBOX_CONFIG.START_TIMEOUT_SECONDS)
  }

  return sandbox
}
