import type { Daytona } from "@daytonaio/sdk"
import { adaptSandbox, getAgent } from "@background-agents/sdk"
import { ENDPOINT_MODEL_PREFIX } from "@background-agents/common"

import { getUserCredentials } from "@/lib/db/api-helpers"
import { getSandboxClaudeCredentials } from "@/lib/claude-credentials"

/** SDK provider name for the `claude-code` agent (see agentToProvider). */
const CLAUDE_PROVIDER_NAME = "claude"

/**
 * Push the current shared Claude credential into a running sandbox.
 *
 * Why this exists: getSandboxClaudeCredentials() now strips the real refresh
 * token before a sandbox ever sees it (see lib/claude-credentials.ts), so a
 * sandbox's Claude CLI can no longer self-refresh — it can only keep using
 * whatever access token it was last given. That's safe for short turns (the
 * access token is ~8h-lived), but a turn that outlives it would otherwise
 * hard-fail with no way to recover.
 *
 * This closes that gap: called every agent-lifecycle cron tick (~once a
 * minute) for every running claude-code chat/job on the shared pool, it
 * re-fetches the current credential and overwrites the sandbox's
 * .credentials.json with it. A long session then rides through however many
 * cron-driven rotations (hourly, only ever the cron's doing) happen during
 * its lifetime, always holding a fresh access token, without ever needing to
 * refresh anything itself.
 *
 * Intentionally unconditional rather than tracking "did the credential
 * actually change since last tick": this cron is stateless across
 * invocations, a plain file overwrite is cheap, and the alternative (persisting
 * a "last synced" watermark somewhere) is more moving parts for a write that
 * is a no-op in effect when nothing changed.
 *
 * No-ops (and never throws — a failed resync just means this sandbox keeps
 * whatever it already has, which is still valid for now) for:
 *  - non-claude-code agents
 *  - custom-endpoint runs (`endpoint:<id>` models supply their own auth)
 *  - users with their own stored Claude credentials — they never used the
 *    shared pool, so overwriting their sandbox would clobber their own token
 *    with ours.
 */
export async function resyncSharedClaudeCredentials(
  sandboxId: string,
  userId: string,
  agent: string,
  model: string | null,
  daytona: Daytona
): Promise<void> {
  if (agent !== "claude-code") return
  if (model?.startsWith(ENDPOINT_MODEL_PREFIX)) return

  try {
    const credentials = await getUserCredentials(userId)
    if (credentials.CLAUDE_CODE_CREDENTIALS) return

    const claudeAgent = getAgent(CLAUDE_PROVIDER_NAME)
    if (!claudeAgent?.capabilities?.setup) return

    const fresh = await getSandboxClaudeCredentials()
    const rawSandbox = await daytona.get(sandboxId)
    const sandbox = adaptSandbox(rawSandbox)
    await claudeAgent.capabilities.setup(sandbox, { CLAUDE_CODE_CREDENTIALS: fresh })
  } catch (err) {
    console.error(
      `[agent-lifecycle] Claude credential resync failed for sandbox ${sandboxId}:`,
      err
    )
  }
}
