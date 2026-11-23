import { prisma } from "@/lib/db/prisma"
import { getSharedClaudeAccessToken, SharedClaudeCredentialsUnavailableError } from "@/lib/claude-credentials"
import { verifyClaudeTokenCapability } from "@/lib/server/claude-token-auth"
import { mountClaudeSecret, TurnSecretsUnavailableError } from "@/lib/server/turn-secrets"
import { claudeSubscriptionSecretEnabled } from "@/lib/server/subscription-secrets"
import { SECRETS_UNAVAILABLE_CODE } from "@/lib/secrets-failure"
import {
  OwnClaudeCredentialsExpiredError,
  OwnClaudeCredentialsUnavailableError,
  getUserClaudeAccessToken,
} from "@/lib/server/user-claude-credentials"
import { Daytona } from "@daytonaio/sdk"

export const runtime = "nodejs"
export const maxDuration = 30
const RESPONSE_HEADERS = { "Cache-Control": "no-store, private" }

/** A credential read only: prompts and model streams never pass through here. */
export async function GET(request: Request): Promise<Response> {
  const bearer = request.headers.get("authorization")
  if (!bearer?.startsWith("Bearer ")) return Response.json({ error: "Unauthorized" }, { status: 401, headers: RESPONSE_HEADERS })
  try {
    const scope = verifyClaudeTokenCapability(bearer.slice(7))
    if (!scope) return Response.json({ error: "Unauthorized" }, { status: 401, headers: RESPONSE_HEADERS })
    const run = await prisma.chat.findFirst({
      where: { id: scope.chatId, userId: scope.userId, agent: "claude-code", status: "running", backgroundSessionId: scope.backgroundSessionId },
      select: { id: true, sandboxId: true },
    })
    if (!run) return Response.json({ error: "Run is no longer active" }, { status: 401, headers: RESPONSE_HEADERS })
    const protectedToken = claudeSubscriptionSecretEnabled(scope.source)
    const daytonaApiKey = process.env.DAYTONA_API_KEY
    // The user's own subscription is refreshed here when it is about to expire.
    const accessToken = scope.source === "own"
      ? await getUserClaudeAccessToken(scope.userId)
      : await getSharedClaudeAccessToken()
    if (!protectedToken) return Response.json({ accessToken }, { headers: RESPONSE_HEADERS })
    if (!daytonaApiKey || !run.sandboxId) {
      console.error("[claude-token] Cannot mount the protected token without a Daytona API key and sandbox")
      throw new TurnSecretsUnavailableError()
    }
    // The turn's other mounted secrets (pool/user keys) aren't known here —
    // this route only refreshes the Claude token mid-turn, it doesn't have
    // the rest of the turn's plan. A Claude Code run authenticates with its
    // subscription token alone, so in practice there's nothing else mounted.
    const placeholder = await mountClaudeSecret(new Daytona({ apiKey: daytonaApiKey }), run.sandboxId, scope.userId, {
      source: scope.source,
      token: accessToken,
    })
    if (!placeholder) {
      console.error("[claude-token] Mount returned no placeholder for the protected token")
      throw new TurnSecretsUnavailableError()
    }
    return Response.json({ accessToken: placeholder }, { headers: RESPONSE_HEADERS })
  } catch (error) {
    if (error instanceof TurnSecretsUnavailableError) {
      return Response.json({ error: error.message, code: SECRETS_UNAVAILABLE_CODE }, { status: 503, headers: RESPONSE_HEADERS })
    }
    if (
      !(error instanceof SharedClaudeCredentialsUnavailableError) &&
      !(error instanceof OwnClaudeCredentialsExpiredError) &&
      !(error instanceof OwnClaudeCredentialsUnavailableError)
    ) {
      // Fetch/DB errors can contain secrets. Log the operation and class only.
      console.error("[claude-token] Credential read failed:", error instanceof Error ? error.name : "Unknown error")
    }
    return Response.json({ error: "Claude credentials are temporarily unavailable" }, { status: 503, headers: RESPONSE_HEADERS })
  }
}
