import { prisma } from "@/lib/db/prisma"
import { getSharedClaudeAccessToken, SharedClaudeCredentialsUnavailableError } from "@/lib/claude-credentials"
import { verifyClaudeTokenCapability } from "@/lib/server/claude-token-auth"
import { mountClaudeSecret } from "@/lib/server/turn-secrets"
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
    // The user's own subscription is refreshed here when it is about to expire.
    const accessToken = scope.source === "own"
      ? await getUserClaudeAccessToken(scope.userId)
      : await getSharedClaudeAccessToken()
    // Behind a Daytona secret, the run gets its placeholder instead (see
    // lib/server/subscription-secrets); otherwise, or if that fails, the token.
    const daytonaApiKey = process.env.DAYTONA_API_KEY
    const placeholder = daytonaApiKey && run.sandboxId
      ? await mountClaudeSecret(new Daytona({ apiKey: daytonaApiKey }), run.sandboxId, scope.userId, {
          source: scope.source,
          token: accessToken,
        })
      : undefined
    return Response.json({ accessToken: placeholder ?? accessToken }, { headers: RESPONSE_HEADERS })
  } catch (error) {
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
