import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import {
  getCreditBalance,
  listCreditTransactions,
  readDebitProvenance,
} from "@/lib/db/credits"
import { microToUsd } from "@/lib/server/credits"

/** One row of the user's own credit history, as the Credits tab renders it. */
export interface UserCreditTransaction {
  id: string
  /** Signed USD: positive credits the balance, negative debits it. */
  amountUsd: number
  balanceAfterUsd: number
  type: string
  description: string | null
  /**
   * What the turn behind a `debit` was worth at API list rates, before the
   * provider's pricing multiplier. Null for every other row type, and for
   * debits written before pricing existed.
   */
  listUsd: number | null
  /** The multiplier applied to `listUsd` to reach `amountUsd`. Null as above. */
  multiplier: number | null
  createdAt: string
}

export interface UserCreditsResponse {
  /** Purchased credits in USD. Negative when the last debit overshot. */
  balanceUsd: number
  /** Most recent movements, newest first. */
  transactions: UserCreditTransaction[]
}

/**
 * GET /api/user/credits — the authenticated user's own credit balance and
 * recent history, for the Credits settings tab.
 *
 * This is the self-serve counterpart to the admin credits endpoint
 * (/api/admin/users/[userId]/credits): same underlying reads, but scoped to
 * the caller's own userId and gated on requireAuth rather than requireAdmin.
 */
export async function GET(): Promise<Response> {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { userId } = auth

  try {
    const [balance, transactions] = await Promise.all([
      getCreditBalance(userId),
      listCreditTransactions({ userId, limit: 20 }),
    ])

    const response: UserCreditsResponse = {
      balanceUsd: microToUsd(balance),
      transactions: transactions.map((t) => {
        const provenance = readDebitProvenance(t.metadata)
        return {
          id: t.id,
          amountUsd: microToUsd(t.amountMicroUsd),
          balanceAfterUsd: microToUsd(t.balanceAfterMicroUsd),
          type: t.type,
          description: t.description,
          listUsd: provenance?.listUsd ?? null,
          multiplier: provenance?.multiplier ?? null,
          createdAt: t.createdAt.toISOString(),
        }
      }),
    }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
