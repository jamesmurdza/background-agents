/**
 * Shared credential pool resolution (server-only).
 *
 * Three agents can run against a server-provided "shared" credential when the
 * user hasn't stored their own key/token: Claude Code (rotating OAuth pool),
 * Gemini and OpenCode (server env keys). Everything else always uses the user's
 * own key. This module centralizes:
 *   - which agents have a shared pool,
 *   - the internal provider id used as the TokenUsage.provider / tokscale client,
 *   - resolving whether a given run is "shared" vs "user" for metering & limits.
 *
 * It also defines the small `metadata.usage` blob stamped on the assistant
 * message at send time so the turn finalizer (which runs later, in the cron)
 * can attribute the run without re-deriving credentials.
 */

import {
  agentToProvider,
  CUSTOM_MODEL_VALUE,
  type Agent,
  type Credentials,
  type ProviderName,
} from "@background-agents/common"
import type { UsagePool } from "@/lib/db/token-usage"

/** Agents backed by a shared (server-provided) credential pool. */
export const SHARED_POOL_AGENTS = ["claude-code", "gemini", "opencode"] as const
export type SharedPoolAgent = (typeof SHARED_POOL_AGENTS)[number]

export function isSharedPoolAgent(agent: Agent): agent is SharedPoolAgent {
  return (SHARED_POOL_AGENTS as readonly string[]).includes(agent)
}

/** Internal provider id for an agent (stored as TokenUsage.provider). */
export function providerForAgent(agent: Agent): ProviderName {
  return agentToProvider[agent]
}

/**
 * Whether a run uses the shared pool ("shared") or the user's own key ("user").
 *
 * `storedCreds` MUST be the user's DB-stored credentials WITHOUT process.env
 * fallback, so server env keys correctly read as shared rather than user-owned.
 * Non-shared-pool agents are always "user".
 *
 * `model` lets a per-run custom-endpoint selection read as "user" even when the
 * account has no stored Claude token (the run uses the user's own endpoint, not
 * the shared pool). Omit it for account-level checks.
 */
export function resolvePool(
  agent: Agent,
  storedCreds: Credentials,
  model?: string
): UsagePool {
  switch (agent) {
    case "claude-code":
      if (model === CUSTOM_MODEL_VALUE) return "user"
      return storedCreds.CLAUDE_CODE_CREDENTIALS ? "user" : "shared"
    case "gemini":
      return storedCreds.GEMINI_API_KEY ? "user" : "shared"
    case "opencode":
      return storedCreds.OPENCODE_API_KEY ? "user" : "shared"
    default:
      return "user"
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Assistant-message metadata carrier
// ─────────────────────────────────────────────────────────────────────────────

/** Shape stamped under Message.metadata.usage at send time. */
export interface UsageMeta {
  pool: UsagePool
  provider: ProviderName
}

/** Build the metadata blob to stamp on the assistant message. */
export function buildUsageMeta(
  agent: Agent,
  storedCreds: Credentials,
  model?: string
): UsageMeta {
  return { pool: resolvePool(agent, storedCreds, model), provider: providerForAgent(agent) }
}

/**
 * Read back the usage metadata from a Message.metadata JSON value. Returns null
 * when absent or malformed (e.g. messages predating this feature).
 */
export function readUsageMeta(metadata: unknown): UsageMeta | null {
  if (!metadata || typeof metadata !== "object") return null
  const usage = (metadata as { usage?: unknown }).usage
  if (!usage || typeof usage !== "object") return null
  const { pool, provider } = usage as { pool?: unknown; provider?: unknown }
  if ((pool === "shared" || pool === "user") && typeof provider === "string") {
    return { pool, provider: provider as ProviderName }
  }
  return null
}
