import { Daytona } from "@daytonaio/sdk"
import { readPersistedSessionId } from "@/lib/agent-session"
import type { Agent } from "@/lib/types"

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
  // OpenAI API key for Codex and OpenCode agents
  openaiApiKey?: string,
  // Agent type to determine which credentials to include
  agent?: Agent
): Promise<{
  sandbox: Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>
  wasResumed: boolean
  resumeSessionId?: string
  env: Record<string, string>
}> {
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(sandboxId)

  // Start sandbox if not running
  if (sandbox.state !== "started") {
    await sandbox.start(120)
  }

  // Read stored session ID for agent resumption
  // Priority: file (latest conversation session, used by SDK) > database (fallback)
  const fileSessionId = await readPersistedSessionId(sandbox)
  const resumeSessionId = fileSessionId || databaseSessionId

  console.log("[sandbox-resume] ensureSandboxReady", {
    sandboxId,
    repoName,
    databaseSessionId,
    fileSessionId,
    resumeSessionId,
  })

  // For Claude Max, write credentials if needed
  if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
    const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
    await sandbox.process.executeCommand(
      `mkdir -p /home/daytona/.claude && echo '${credentialsB64}' | base64 -d > /home/daytona/.claude/.credentials.json && chmod 600 /home/daytona/.claude/.credentials.json`
    )
  }

  // Build environment variables for SDK
  const env: Record<string, string> = {}

  // Set API key environment if using API key auth
  if (anthropicAuthType !== "claude-max" && anthropicApiKey) {
    env.ANTHROPIC_API_KEY = anthropicApiKey
  }

  // Include OpenAI API key for OpenCode (supports multiple providers)
  // OpenCode can use ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY
  // It also works with big-pickle models without any API key
  if (openaiApiKey) {
    env.OPENAI_API_KEY = openaiApiKey
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
  const sandbox = await daytona.get(sandboxId)

  if (sandbox.state !== "started") {
    await sandbox.start(120)
  }

  return sandbox
}
