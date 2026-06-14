import { NextRequest } from "next/server"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  internalError,
} from "@/lib/db/api-helpers"
import { sumChatUsageByProvider } from "@/lib/db/token-usage"
import { ALL_AGENTS, agentLabels, agentToProvider } from "@background-agents/common"

/** Reverse map: SDK provider id → human label (via its agent). */
const PROVIDER_LABELS: Record<string, string> = Object.fromEntries(
  ALL_AGENTS.map((agent) => [agentToProvider[agent], agentLabels[agent]])
)

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

/** Per-provider token usage for a single chat. */
export interface ChatUsageResponse {
  /** Total tokens recorded for this chat across all providers. */
  total: number
  providers: { provider: string; label: string; tokens: number }[]
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

    const rows = await sumChatUsageByProvider(chatId)
    const providers = rows.map((r) => ({
      provider: r.provider,
      label: providerLabel(r.provider),
      tokens: r.totalTokens,
    }))
    const total = providers.reduce((sum, p) => sum + p.tokens, 0)

    const response: ChatUsageResponse = { total, providers }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
