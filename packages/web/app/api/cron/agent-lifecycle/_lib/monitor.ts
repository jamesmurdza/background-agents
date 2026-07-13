import { Daytona } from "@daytonaio/sdk"

import { PATHS } from "@/lib/constants"
import {
  snapshotBackgroundAgent,
  cancelBackgroundAgent,
  type AgentSnapshot,
} from "@/lib/agent-session"

// =============================================================================
// Shared monitor logic — used by both interactive chats and scheduled runs.
// =============================================================================

/**
 * Snapshot a running background agent and dispatch to the appropriate handler
 * when it reaches a terminal state. Keeps the sandbox alive via refreshActivity.
 * Swallows errors (logged) so a single failing sandbox doesn't break the cron.
 */
export async function monitorAgent(
  sandboxId: string,
  backgroundSessionId: string,
  daytona: Daytona,
  handlers: {
    onComplete: (snapshot: AgentSnapshot) => Promise<void>
    onError: (error: string, errorKind?: AgentSnapshot["errorKind"]) => Promise<void>
  }
) {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.refreshActivity() // Keep alive

    const snapshot = await snapshotBackgroundAgent(sandbox, backgroundSessionId, {
      repoPath: `${PATHS.SANDBOX_HOME}/project`,
    })

    if (snapshot.status === "completed") {
      await handlers.onComplete(snapshot)
    } else if (snapshot.status === "error") {
      // The turn errored, but its process may still be alive — e.g. OpenCode
      // retrying a rate/usage-limited model call with unbounded backoff. Reap
      // it so it doesn't keep running after we've recorded the failure.
      // Best-effort and idempotent: a no-op when the process already exited.
      await cancelBackgroundAgent(sandbox, backgroundSessionId, {
        repoPath: `${PATHS.SANDBOX_HOME}/project`,
      })
      await handlers.onError(snapshot.error ?? "Unknown error", snapshot.errorKind)
    }
    // else still running, check again next cycle
  } catch (err) {
    console.error(`[agent-lifecycle] Monitor error:`, err)
  }
}

/**
 * Forcibly cancel a running background agent (used on hard-timeout).
 */
export async function stopAgent(
  sandboxId: string,
  backgroundSessionId: string,
  daytona: Daytona
) {
  try {
    const sandbox = await daytona.get(sandboxId)
    await cancelBackgroundAgent(sandbox, backgroundSessionId, {
      repoPath: `${PATHS.SANDBOX_HOME}/project`,
    })
  } catch (err) {
    console.error(`[agent-lifecycle] Failed to stop agent:`, err)
  }
}
