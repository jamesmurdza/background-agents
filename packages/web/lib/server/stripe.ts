/**
 * Stripe client, credit packs, and the billing kill switch.
 *
 * The integration is deliberately small: hosted Checkout in `payment` mode, so
 * Stripe owns the card form, SCA, wallets and receipts, and we own a redirect
 * out and a webhook back. There is no Stripe app, no Connect account and no
 * OAuth — the server calls Stripe with a secret key and nothing about a user's
 * own Stripe account is ever involved.
 */

import Stripe from "stripe"

/**
 * The API version this code was written against.
 *
 * Pinned here rather than left to the dashboard: unpinned, a version bump on
 * Stripe's side changes webhook payload shapes without a deploy on ours. It
 * matches what `stripe@22.x` ships with; bump both together.
 */
const STRIPE_API_VERSION = "2026-08-26.dahlia"

let client: Stripe | null = null

/** The shared Stripe client. Throws when no secret key is configured. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set")
  }
  if (!client) {
    client = new Stripe(key, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion })
  }
  return client
}

/**
 * Whether billing is live for this deployment.
 *
 * Off by default, and off unless every piece is present, so a half-configured
 * environment fails closed: the routes 404 and the UI hides top-up rather than
 * offering a checkout that cannot complete.
 */
export function isBillingEnabled(): boolean {
  return (
    process.env.BILLING_ENABLED === "true" &&
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_WEBHOOK_SECRET
  )
}

/**
 * Pack id → Stripe price id, from `STRIPE_PRICE_MAP`.
 *
 * The map lives in the environment because price ids differ between test and
 * live mode — Stripe objects do not cross the two — so hard-coding them would
 * mean a code change at launch.
 *
 * It is also the security boundary for checkout: the client sends a pack id,
 * never an amount, and only ids in this map can be bought. Trusting a
 * client-sent amount is how a $100 pack gets bought for a cent.
 */
export function getPriceMap(): Record<string, string> {
  const raw = process.env.STRIPE_PRICE_MAP
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.startsWith("price_")) out[k] = v
    }
    return out
  } catch {
    console.error("[stripe] STRIPE_PRICE_MAP is not valid JSON — no packs available")
    return {}
  }
}

/** A purchasable pack, as the UI needs it. */
export interface CreditPack {
  id: string
  priceId: string
  /** Fixed amount in USD, or null for a customer-chosen amount. */
  amountUsd: number | null
  /** Bounds for a customer-chosen amount, in USD. */
  minUsd?: number
  maxUsd?: number
  presetUsd?: number
  /**
   * The price's product and currency. Needed only for a customer-chosen
   * amount, where checkout bills an ad-hoc `price_data` line against this
   * product rather than sending the user to Stripe to type the amount there.
   */
  productId: string
  currency: string
}

interface PackCache {
  packs: CreditPack[]
  at: number
}
let packCache: PackCache | null = null
const PACK_CACHE_MS = 10 * 60 * 1000

/**
 * The packs on sale, with amounts read from Stripe rather than duplicated in
 * the environment — so the price a user is shown is by construction the price
 * they are charged, and changing a pack means changing it in one place.
 *
 * Cached for ten minutes per instance. A price is not something that changes
 * without a deploy, and checkout itself only needs the id, so a stale read here
 * can never mis-charge anyone.
 *
 * Prices that are recurring are dropped: `mode: "payment"` rejects them, so a
 * subscription price left in the map would fail at the redirect rather than
 * here. Better to never offer it, and to say so in the log.
 */
export async function getCreditPacks(): Promise<CreditPack[]> {
  if (packCache && Date.now() - packCache.at < PACK_CACHE_MS) {
    return packCache.packs
  }

  const map = getPriceMap()
  const stripe = getStripe()
  const packs: CreditPack[] = []

  for (const [id, priceId] of Object.entries(map)) {
    try {
      const price = await stripe.prices.retrieve(priceId)
      if (!price.active) continue
      if (price.recurring) {
        console.error(
          `[stripe] pack "${id}" (${priceId}) is a recurring price; ` +
            `payment-mode Checkout cannot sell it. Skipping.`
        )
        continue
      }
      const custom = price.custom_unit_amount
      packs.push({
        id,
        priceId,
        productId: typeof price.product === "string" ? price.product : price.product.id,
        currency: price.currency,
        amountUsd: price.unit_amount != null ? price.unit_amount / 100 : null,
        ...(custom
          ? {
              minUsd: (custom.minimum ?? 0) / 100,
              maxUsd: (custom.maximum ?? 0) / 100,
              presetUsd: (custom.preset ?? custom.minimum ?? 0) / 100,
            }
          : {}),
      })
    } catch (err) {
      console.error(`[stripe] could not load price for pack "${id}" (${priceId}):`, err)
    }
  }

  // Fixed amounts ascending, then any customer-chosen amount last.
  packs.sort((a, b) => (a.amountUsd ?? Infinity) - (b.amountUsd ?? Infinity))

  packCache = { packs, at: Date.now() }
  return packs
}

/** One pack by id, or null when the id is not one this deployment sells. */
export async function getCreditPack(packId: string): Promise<CreditPack | null> {
  return (await getCreditPacks()).find((p) => p.id === packId) ?? null
}

/** Absolute URL for a path on this deployment, for Checkout's redirect URLs. */
export { appUrl } from "./app-url"
