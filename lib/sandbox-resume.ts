import { Daytona } from "@daytonaio/sdk"
import { CODING_AGENT_SCRIPT } from "@/lib/coding-agent-script"

/**
 * Ensures a sandbox is running and the agent context is ready.
 * If the sandbox was stopped, it restarts it, re-uploads the agent script,
 * and re-initializes the agent with session resumption.
 */
export async function ensureSandboxReady(
  daytonaApiKey: string,
  sandboxId: string,
  repoName: string,
  previewUrlPattern?: string,
  anthropicApiKey?: string,
  anthropicAuthType?: string,
  anthropicAuthToken?: string,
): Promise<{
  sandbox: Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>
  contextId: string
  wasResumed: boolean
  resumeSessionId?: string
}> {
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(sandboxId)

  const repoPath = `/home/daytona/${repoName}`

  // If sandbox is already started, try to find an existing context
  if (sandbox.state === "started") {
    try {
      const contexts = await sandbox.codeInterpreter.listContexts()
      if (contexts.length > 0) {
        let resumeSessionId: string | undefined
        try {
          const result = await sandbox.process.executeCommand(
            "cat /home/daytona/.agent_session_id 2>/dev/null"
          )
          if (!result.exitCode && result.result.trim()) {
            resumeSessionId = result.result.trim()
          }
        } catch {
          // ignore
        }
        return { sandbox, contextId: contexts[0].id, wasResumed: false, resumeSessionId }
      }
    } catch {
      // Context listing failed — fall through to re-create
    }
  }

  // Sandbox is stopped or has no context — start it
  if (sandbox.state !== "started") {
    await sandbox.start(120)
  }

  // Read stored session ID for agent resumption
  let resumeSessionId: string | undefined
  try {
    const result = await sandbox.process.executeCommand(
      "cat /home/daytona/.agent_session_id 2>/dev/null"
    )
    if (!result.exitCode && result.result.trim()) {
      resumeSessionId = result.result.trim()
    }
  } catch {
    // No stored session — that's fine
  }

  // Verify agent script exists, re-upload if missing
  const checkScript = await sandbox.process.executeCommand(
    "test -f /tmp/coding_agent.py && echo exists"
  )
  if (!checkScript.result.includes("exists")) {
    const scriptB64 = Buffer.from(CODING_AGENT_SCRIPT).toString("base64")
    await sandbox.process.executeCommand(
      `echo '${scriptB64}' | base64 -d > /tmp/coding_agent.py`
    )
  }

  // Re-install Agent SDK if needed (best-effort, may already be installed)
  await sandbox.process.executeCommand(
    "python3 -c 'import claude_agent_sdk' 2>/dev/null || python3 -m pip install claude-agent-sdk==0.1.19 2>&1"
  )

  // For Claude Max, re-write credentials if needed
  if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
    const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
    await sandbox.process.executeCommand(
      `mkdir -p /home/daytona/.claude && echo '${credentialsB64}' | base64 -d > /home/daytona/.claude/.credentials.json && chmod 600 /home/daytona/.claude/.credentials.json`
    )
  }

  // Create a new code interpreter context
  const ctx = await sandbox.codeInterpreter.createContext(repoPath)

  // Build env vars for agent init
  const envs: Record<string, string> = { REPO_PATH: repoPath }
  if (previewUrlPattern) envs.PREVIEW_URL_PATTERN = previewUrlPattern
  if (resumeSessionId) envs.RESUME_SESSION_ID = resumeSessionId

  // Initialize the coding agent
  const initResult = await sandbox.codeInterpreter.runCode(
    `import sys; sys.path.insert(0, '/tmp'); import os, coding_agent;`,
    {
      context: ctx,
      envs: {
        ...envs,
        ...(anthropicAuthType !== "claude-max" && anthropicApiKey
          ? { ANTHROPIC_API_KEY: anthropicApiKey }
          : {}),
      },
    }
  )
  if (initResult.error) {
    throw new Error(`Failed to initialize agent: ${initResult.error.value}`)
  }

  return { sandbox, contextId: ctx.id, wasResumed: true, resumeSessionId }
}

/**
 * Lighter version — just ensures a sandbox is running.
 * Used for git/SSH operations that don't need the agent context.
 */
export async function ensureSandboxStarted(
  daytonaApiKey: string,
  sandboxId: string,
): Promise<Awaited<ReturnType<InstanceType<typeof Daytona>["get"]>>> {
  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const sandbox = await daytona.get(sandboxId)

  if (sandbox.state !== "started") {
    await sandbox.start(120)
  }

  return sandbox
}
