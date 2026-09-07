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
    /**
     * `snapshot` carries the agent CLI's own session id, which is the id
     * tokscale reports usage under — NOT the Daytona backgroundSessionId this
     * function is called with. A failure handler that wants to bill the dying
     * turn needs the former, and this is the only place it is known.
     */
    onError: (
      error: string,
      errorKind: AgentSnapshot["errorKind"],
      snapshot: AgentSnapshot
    ) => Promise<void>
  }
) {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.refreshActivity() // Keep alive

    const snapshot = await snapshotBackgroundAgent(sandbox, backgroundSessionId, {
      repoPath: `${PATHS.SANDBOX_HOME}/project`,
    })

    if (snapshot.transientReadFailure) {
      // Reading the session failed transiently (network blip, brief file-read
      // race) — this is not evidence the agent errored, just that we
      // couldn't read its state this tick. Don't cancel a possibly-healthy
      // agent or record a spurious failure; just check again next cycle.
      return
    }

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
      await handlers.onError(
        snapshot.error ?? "Unknown error",
        snapshot.errorKind,
        snapshot
      )
    }
    // else still running, check again next cycle
  } catch (err) {
    console.error(`[agent-lifecycle] Monitor error:`, err)
  }
}

/**
 * Forcibly cancel a running background agent (used on hard-timeout).
 *
 * Returns the agent CLI's session id, read before the cancel while the session
 * is still answering, so the caller can bill the turn it just killed. A timed
 * out run has usually spent more than any other kind of failure, so losing this
 * id is expensive. Undefined when the snapshot could not be read.
 */
export async function stopAgent(
  sandboxId: string,
  backgroundSessionId: string,
  daytona: Daytona
): Promise<string | undefined> {
  try {
    const sandbox = await daytona.get(sandboxId)
    const options = { repoPath: `${PATHS.SANDBOX_HOME}/project` }
    // Read first, cancel second: the id is what makes the usage billable, and
    // a cancelled session may no longer report it.
    let agentSessionId: string | undefined
    try {
      agentSessionId = (await snapshotBackgroundAgent(sandbox, backgroundSessionId, options))
        .sessionId
    } catch (err) {
      console.error(`[agent-lifecycle] Could not read session id before stop:`, err)
    }
    await cancelBackgroundAgent(sandbox, backgroundSessionId, options)
    return agentSessionId
  } catch (err) {
    console.error(`[agent-lifecycle] Failed to stop agent:`, err)
    return undefined
  }
}
