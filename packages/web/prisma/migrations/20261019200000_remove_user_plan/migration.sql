-- Remove subscription tiers (free / pro / unlimited). Every account is now
-- gated the same way: on its credit balance, refilled daily to the single
-- DAILY_CREDIT_TARGET_USD in lib/server/credits.
--
-- `pro` had no members when this ran. `unlimited` did: those accounts were
-- ungated and never spent credits, so dropping the tier would otherwise leave
-- them on whatever balance they happened to hold. As a one-off for the move,
-- each is credited 100 credits ($100 = 100,000,000 micro-dollars) on top of its
-- current balance, before the column that identifies them is dropped.
--
-- The figure is frozen here on purpose: a migration records what was actually
-- granted on the day it ran.
--
-- Same shape as 20260905120000_backfill_signup_credits: the balance write and
-- its ledger row are one data-modifying CTE, so a balance can never move
-- without the row that explains it. The `externalId` is uniquely indexed and
-- the NOT EXISTS skips anyone already granted, so the grant is once-only even
-- if this were somehow applied twice.

WITH granted AS (
    UPDATE "User" u
    SET "creditBalanceMicroUsd" = u."creditBalanceMicroUsd" + 100000000
    WHERE u."plan" = 'unlimited'
      AND NOT EXISTS (
          SELECT 1
          FROM "CreditTransaction" t
          WHERE t."externalId" = 'plan_removal:' || u."id"
      )
    RETURNING u."id", u."creditBalanceMicroUsd"
)
INSERT INTO "CreditTransaction" (
    "id",
    "userId",
    "amountMicroUsd",
    "balanceAfterMicroUsd",
    "type",
    "externalId",
    "description",
    "metadata",
    "createdAt"
)
SELECT
    -- Derived from the user id rather than random, so the primary key is a
    -- further idempotency guard and this needs no uuid function.
    'plan_removal_' || g."id",
    g."id",
    100000000,
    g."creditBalanceMicroUsd",
    'grant',
    'plan_removal:' || g."id",
    'Unlimited plan retired',
    jsonb_build_object('previousPlan', 'unlimited'),
    CURRENT_TIMESTAMP
FROM granted g;

ALTER TABLE "User" DROP COLUMN "plan";

DROP TYPE "Plan";
