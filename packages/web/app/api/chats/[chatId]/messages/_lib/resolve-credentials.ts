import { getGitHubToken, getUserCredentials } from "@/lib/db/api-helpers"
import { logActivityAsync } from "@/lib/db/activity-log"
import { checkSharedPoolUsage } from "@/lib/db/usage-limit"
import { getSharedClaudeAccessToken } from "@/lib/claude-credentials"
import { applyCodexSubscription } from "@/lib/server/codex-credentials"
import type { ClaudeRunToken } from "@/lib/server/subscription-secrets"
import {
  OwnClaudeCredentialsExpiredError,
  getUserClaudeAccessToken,
} from "@/lib/server/user-claude-credentials"
import { ENDPOINT_MODEL_PREFIX } from "@background-agents/common"
import type { Agent } from "@/lib/agent-session"
import type { Credentials } from "@/lib/credentials"
import type { MessagePayload } from "./types"

export interface ResolvedCredentials {
  credentials: Credentials
  githubToken: string | null
  /** True when the shared pool should supply this run's OAuth access token (billed as such). */
  useSharedClaude: boolean
  /**
   * The access token a Claude Code subscription run fetches through its token
   * runner (shared, or the user's own), as of now: for putting it behind a
   * secret (lib/server/turn-secrets). Undefined for every other run.
   */
  claudeToken?: ClaudeRunToken
}

/**
 * Resolve the GitHub token + agent credentials for this send and enforce the
 * shared-pool daily budget.
 *
 * Returns a `Response` for the two early-exit cases:
 *  - 429 DAILY_LIMIT_EXCEEDED when the shared-pool budget is spent.
 *  - 503 SHARED_CREDS_UNAVAILABLE when the Claude shared credential can't be
 *    fetched and the user has no own-key fallback.
 *  - 400 CLAUDE_CREDENTIALS_EXPIRED / 503 CLAUDE_CREDENTIALS_UNAVAILABLE when
 *    the user's own Claude subscription can't be refreshed.
 *
 * Otherwise returns the resolved credentials. The Gemini/OpenCode shared keys
 * come from `process.env` via {@link getUserCredentials}, so only Claude Code
 * needs an explicit shared-pool availability check here.
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

  // Validate subscription credentials before claiming a turn. The SDK's OAuth
  // host callback obtains only access tokens; refresh tokens, shared or the
  // user's own, stay here. A custom endpoint (any `endpoint:<id>`) supplies
  // its own auth, so it never uses either.
  let useSharedClaude = false
  let claudeToken: ClaudeRunToken | undefined
  const claudeSubscriptionRun = payload.agent === "claude-code" && !payload.model?.startsWith(ENDPOINT_MODEL_PREFIX)
  if (claudeSubscriptionRun && credentials.CLAUDE_CODE_CREDENTIALS) {
    try {
      claudeToken = { source: "own", token: await getUserClaudeAccessToken(userId) }
    } catch (err) {
      const expired = err instanceof OwnClaudeCredentialsExpiredError
      if (!expired) {
        console.error("[chats/messages] Failed to refresh the user's Claude subscription:", err instanceof Error ? err.name : "Unknown error")
      }
      return Response.json(
        {
          error: expired ? "CLAUDE_CREDENTIALS_EXPIRED" : "CLAUDE_CREDENTIALS_UNAVAILABLE",
          message: err instanceof Error && expired ? err.message : "Couldn't refresh your Claude subscription. Please try again.",
        },
        { status: expired ? 400 : 503 }
      )
    }
  } else if (claudeSubscriptionRun) {
    try {
      claudeToken = { source: "shared", token: await getSharedClaudeAccessToken() }
      useSharedClaude = true
    } catch (err) {
      console.error(
        "[chats/messages] Failed to fetch shared Claude credential:",
        // Database failures may contain credential-bearing connection URLs.
        err instanceof Error ? err.name : "Unknown error"
      )
      return Response.json(
        {
          error: "SHARED_CREDS_UNAVAILABLE",
          message: "Shared Claude is temporarily unavailable. Please try again later.",
        },
        { status: 503 }
      )
    }
  }

  // Codex ChatGPT subscription. This ALWAYS strips the stored CODEX_CREDENTIALS
  // blob (which carries the user's real refresh token) and only then re-adds a
  // freshly rendered auth.json when the subscription applies to this run. See
  // applyCodexSubscription for why the strip must be unconditional.
  credentials = await applyCodexSubscription(
    credentials,
    userId,
    payload.agent,
    payload.model
  )

  return { credentials, githubToken, useSharedClaude, claudeToken }
}
