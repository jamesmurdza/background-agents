import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { DAILY_CREDIT_TARGET_USD, usdToMicro } from "@/lib/server/credits"

/**
 * Daily credit refill.
 *
 * Once per UTC day, raises every balance below {@link DAILY_CREDIT_TARGET_USD}
 * to exactly that, and leaves everything at or above it alone. The grant is the
 * shortfall, so a user at $0.10 gets $0.15 and one at $0 gets $0.25. Negative
 * balances are refilled in full — see the constant for what that costs us and
 * why it was chosen anyway.
 *
 * One statement, not a loop over users. Production caps the Prisma pool at one
 * connection per instance, so several hundred sequential transactions would
 * monopolise it for the duration; and the whole point of the operation is that
 * it either applies to a user today or does not, which a single data-modifying
 * CTE expresses directly. Same shape as migration
 * 20260905120000_backfill_signup_credits, for the same reasons.
 *
 * Exactly-once per user per UTC day rests on `CreditTransaction.externalId`
 * being uniquely indexed: the `NOT EXISTS` skips anyone already refilled, and if
 * two runs race past it the index aborts the statement — which rolls the balance
 * write back with it, because both halves are one statement. Setting a level
 * rather than adding to one is a second line of defence: even an applied
 * duplicate would land on the same balance.
 *
 * No catch-up for a missed day. A refill to a fixed level has nothing to catch
 * up on — the next run puts the user exactly where the missed one would have.
 */
// maxDuration configures the timeout for this Vercel function.
export const maxDuration = 60

/** The refill target in micro-dollars, resolved once at module load. */
const TARGET_MICRO = usdToMicro(DAILY_CREDIT_TARGET_USD)

export async function GET(req: Request) {
  // Verify cron secret (skip auth if not configured, for local development)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  // The UTC day is the idempotency key, so it is computed here and passed in
  // rather than read from the database clock: two instances that disagree about
  // "today" would each get their own refill through the NOT EXISTS.
  const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const idPrefix = `daily_${day.replace(/-/g, "")}_`
  const keyPrefix = `daily:`

  try {
    // `eligible` is a separate CTE because the amount granted is the shortfall,
    // which needs the balance from *before* the write. Every CTE in a statement
    // reads the same snapshot, so this sees pre-update values; Postgres has no
    // `RETURNING OLD` until 18.
    //
    // Every interpolation is cast explicitly. Prisma sends these as untyped bind
    // parameters, and Postgres cannot infer a type for one that appears only
    // inside a `||` concatenation — it fails the whole statement with "could not
    // determine data type of parameter" rather than guessing.
    const refilled = await prisma.$executeRaw`
      WITH eligible AS (
        SELECT u."id",
               u."creditBalanceMicroUsd" AS before,
               ${TARGET_MICRO}::bigint AS target
          FROM "User" u
         WHERE NOT EXISTS (
           SELECT 1 FROM "CreditTransaction" t
            WHERE t."externalId" = ${keyPrefix}::text || u."id" || ':' || ${day}::text
         )
      ),
      topped AS (
        UPDATE "User" u
           SET "creditBalanceMicroUsd" = e."target"
          FROM eligible e
         WHERE u."id" = e."id"
           AND e."before" < e."target"
        RETURNING u."id", e."before", e."target",
                  u."creditBalanceMicroUsd" AS after
      )
      INSERT INTO "CreditTransaction" (
        "id", "userId", "amountMicroUsd", "balanceAfterMicroUsd",
        "type", "externalId", "description", "metadata", "createdAt"
      )
      SELECT
        -- Derived from user + day rather than random, so the primary key is a
        -- second idempotency guard behind the unique "externalId" index.
        ${idPrefix}::text || t."id",
        t."id",
        t."after" - t."before",
        t."after",
        'daily',
        ${keyPrefix}::text || t."id" || ':' || ${day}::text,
        'Daily credit',
        jsonb_build_object(
          'day', ${day}::text,
          'targetMicro', t."target"
        ),
        CURRENT_TIMESTAMP
      FROM topped t
    `

    console.log(
      `[daily-credits] refilled ${refilled} user${refilled === 1 ? "" : "s"} for ${day}`
    )
    return Response.json({ day, refilled, targetUsd: DAILY_CREDIT_TARGET_USD })
  } catch (error) {
    // A unique-constraint violation here means a concurrent run won the race and
    // already refilled today — the statement rolled back whole, so nothing is
    // half-applied and there is nothing to repair.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.warn(`[daily-credits] concurrent run already refilled for ${day}`)
      return Response.json({ day, refilled: 0, targetUsd: DAILY_CREDIT_TARGET_USD })
    }
    console.error("[daily-credits] failed:", error)
    return new Response("Daily credit refill failed", { status: 500 })
  }
}
