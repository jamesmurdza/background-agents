import { NextRequest, NextResponse } from "next/server"

import { requireAdmin, isAuthError } from "@/lib/db/api-helpers"
import { logActivity } from "@/lib/db/activity-log"
import { listProviderPricing, setProviderMultiplier } from "@/lib/db/provider-pricing"
import { DEFAULT_MULTIPLIER } from "@/lib/server/credits"
import { BALANCE_POOL_PROVIDERS } from "@/lib/server/usage-budgets"

/**
 * Admin read/write for the per-provider pricing multiplier — the /admin
 * "Pricing" panel. See lib/db/provider-pricing for the cached read path every
 * turn actually charges against, and lib/server/credits for the arithmetic
 * (`chargeableUsd = listUsd * multiplier`) and why 0 means free.
 *
 * Scoped to {@link BALANCE_POOL_PROVIDERS}: those are the only providers
 * `chargeTurnToCredits` ever charges (see its `BALANCE_POOL_PROVIDERS.includes`
 * guard), so a multiplier for anything else would be a knob that does nothing
 * — surfacing it in the admin panel would just be confusing.
 */

export interface ProviderPricingResponse {
  providers: {
    provider: string
    multiplier: number
    updatedAt: string | null
    updatedBy: string | null
  }[]
}

export async function GET() {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  const rows = await listProviderPricing()
  const byProvider = new Map(rows.map((r) => [r.provider, r]))

  const providers = BALANCE_POOL_PROVIDERS.map((provider) => {
    const row = byProvider.get(provider)
    return {
      provider,
      multiplier: row ? row.multiplier : DEFAULT_MULTIPLIER,
      updatedAt: row ? row.updatedAt.toISOString() : null,
      updatedBy: row?.updatedBy ?? null,
    }
  })

  return NextResponse.json({ providers } satisfies ProviderPricingResponse)
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin()
  if (isAuthError(auth)) return auth

  let body: { provider?: unknown; multiplier?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { provider, multiplier } = body
  if (typeof provider !== "string" || !BALANCE_POOL_PROVIDERS.includes(provider as never)) {
    return NextResponse.json(
      { error: `provider must be one of: ${BALANCE_POOL_PROVIDERS.join(", ")}` },
      { status: 400 }
    )
  }
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier) || multiplier < 0) {
    return NextResponse.json(
      { error: "multiplier must be a finite number >= 0" },
      { status: 400 }
    )
  }

  try {
    await setProviderMultiplier(provider, multiplier, auth.userId)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to set multiplier" },
      { status: 400 }
    )
  }

  await logActivity(auth.userId, "provider_pricing_updated", {
    provider,
    multiplier,
  })

  return NextResponse.json({ provider, multiplier })
}
