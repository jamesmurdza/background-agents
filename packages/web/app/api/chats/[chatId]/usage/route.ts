import { NextRequest } from "next/server"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { sumChatUsageByProvider } from "@/lib/db/token-usage"
import { sumChatCreditsByProvider } from "@/lib/db/credits"
import { providerLabel } from "@background-agents/common"

/**
 * Per-provider usage for a single chat: tokens, their API list-price value, and
 * the credits actually charged for them.
 *
 * The two money columns are different questions and both are worth answering.
 * `costUsd` spans every provider the chat touched, including ones with no shared
 * pool, and counts own-key runs — which cost the platform nothing — so it says
 * what the conversation was worth. `creditsChargedUsd` is what came off the
 * balance: list value times the provider's pricing multiplier (see the admin
 * Pricing panel), and zero for own-key runs, free models, a provider an admin
 * has set to a 0 multiplier, and `unlimited` accounts. Showing only the first
 * would overstate what the chat cost the user — at the seeded multipliers, by
 * up to 20× for Claude.
 */
export interface ChatProviderUsageView {
  provider: string
  label: string
  /** Total tokens recorded for this provider in the chat (cache included). */
  totalTokens: number
  /** Those tokens priced at API list rates, in USD. Zero for free models. */
  costUsd: number
  /** Credits actually debited for this provider in this chat. */
  creditsChargedUsd: number
}

export interface ChatUsageResponse {
  providers: ChatProviderUsageView[]
}

// =============================================================================
// GET - token usage for a single chat, grouped by provider
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) return notFound("Chat not found")

    const [rows, credits] = await Promise.all([
      sumChatUsageByProvider(chatId),
      sumChatCreditsByProvider(chatId),
    ])
    // A provider with usage but no debit is the normal case for own-key runs and
    // free models, so a miss here is 0 rather than an omission.
    const chargedByProvider = new Map(credits.map((c) => [c.provider, c.chargedUsd]))
    const providers: ChatProviderUsageView[] = rows.map((r) => ({
      provider: r.provider,
      label: providerLabel(r.provider),
      totalTokens: r.totalTokens,
      costUsd: r.costUsd,
      creditsChargedUsd: chargedByProvider.get(r.provider) ?? 0,
    }))

    const response: ChatUsageResponse = { providers }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
