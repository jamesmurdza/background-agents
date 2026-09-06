import { getGitHubToken, getUserCredentials } from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"
import { checkSharedPoolUsage } from "@/lib/db/usage-limit"
import { getClaudeCredentials } from "@/lib/claude-credentials"
import { resolveCodexAuthJson } from "@/lib/server/codex-credentials"
import { CODEX_SUBSCRIPTION_ENABLED } from "@/lib/codex-credentials"
import { ENDPOINT_MODEL_PREFIX } from "@background-agents/common"
import type { Agent } from "@/lib/agent-session"
import type { Credentials } from "@/lib/credentials"
import type { MessagePayload } from "./types"

export interface ResolvedCredentials {
  credentials: Credentials
  githubToken: string | null
  /** True when the rotating shared Claude credential was injected (free-tier fallback). */
  useSharedClaude: boolean
}

/**
 * Resolve the GitHub token + agent credentials for this send and enforce the
 * shared-pool daily budget.
 *
 * Returns a `Response` for the two early-exit cases:
 *  - 429 DAILY_LIMIT_EXCEEDED when the shared-pool budget is spent.
 *  - 503 SHARED_CREDS_UNAVAILABLE when the Claude shared credential can't be
 *    fetched and the user has no own-key fallback.
 *
 * Otherwise returns the resolved credentials. The Gemini/OpenCode shared keys
 * come from `process.env` via {@link getUserCredentials}, so only Claude Code
 * needs the explicit shared-credential injection here.
 */
export async function resolveSendCredentials(
  userId: string,
  payload: MessagePayload
): Promise<ResolvedCredentials | Response> {
  const githubToken = await getGitHubToken(userId)

  let credentials = await getUserCredentials(userId)

  // Enforce the per-provider daily budget on shared pools. Free and Pro are
  // capped; Unlimited, own-key runs, and agents without a shared pool are
  // allowed — so this is safe to call unconditionally.
  const usageCheck = await checkSharedPoolUsage(userId, payload.agent as Agent, payload.model)
  if (!usageCheck.allowed) {
    logActivityAsync(userId, "daily_limit_reached", {
      provider: usageCheck.provider,
      used: usageCheck.used,
      limit: usageCheck.limit,
      creditBalance: usageCheck.creditBalance,
      resetAt: usageCheck.resetAt.toISOString(),
    })

    return Response.json(
      {
        error: "DAILY_LIMIT_EXCEEDED",
        message: usageCheck.error,
        provider: usageCheck.provider,
        used: usageCheck.used,
        remaining: usageCheck.remaining,
        limit: usageCheck.limit,
        // Negative when the last turn overshot: the client shows "top up to
        // clear it" rather than "come back tomorrow", which would be a lie.
        creditBalance: usageCheck.creditBalance,
        resetAt: usageCheck.resetAt.toISOString(),
      },
      { status: 429 }
    )
  }

  // Shared-pool fallback for Claude Code: when the user hasn't stored their own
  // subscription token, inject the rotating credential blob written by
  // /api/cron/refresh-claude-creds.
  let useSharedClaude = false
  if (
    payload.agent === "claude-code" &&
    // A custom endpoint (any `endpoint:<id>`) supplies its own auth, so never
    // fall back to the shared Claude pool for it.
    !payload.model?.startsWith(ENDPOINT_MODEL_PREFIX) &&
    !credentials.CLAUDE_CODE_CREDENTIALS
  ) {
    try {
      credentials = {
        ...credentials,
        CLAUDE_CODE_CREDENTIALS: await getClaudeCredentials(),
      }
      useSharedClaude = true
    } catch (err) {
      console.error(
        "[chats/messages] Failed to fetch shared Claude credential:",
        err
      )
      return Response.json(
        {
          error: "SHARED_CREDS_UNAVAILABLE",
          message:
            "Shared Claude credentials are unavailable. Add your own Claude Subscription token in Settings.",
        },
        { status: 503 }
      )
    }
  }

  // Codex ChatGPT subscription: mint a fresh access token and render the
  // auth.json the sandbox will receive. A custom endpoint supplies its own
  // auth, so it never takes this path. Returns null when the user has no
  // usable subscription, leaving OPENAI_API_KEY to serve the run.
  if (
    CODEX_SUBSCRIPTION_ENABLED &&
    payload.agent === "codex" &&
    !payload.model?.startsWith(ENDPOINT_MODEL_PREFIX)
  ) {
    const authJson = await resolveCodexAuthJson(userId)
    if (authJson) {
      credentials = { ...credentials, CODEX_CREDENTIALS: authJson }
    }
  }

  return { credentials, githubToken, useSharedClaude }
}
