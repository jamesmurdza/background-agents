-- Subscription tier enum + column, replacing the boolean `isPro`.
--   free      → per-provider daily budget
--   pro       → 2× the free daily budget
--   unlimited → no shared-pool cap
CREATE TYPE "Plan" AS ENUM ('free', 'pro', 'unlimited');

ALTER TABLE "User" ADD COLUMN "plan" "Plan" NOT NULL DEFAULT 'free';

-- Existing Pro subscribers map to the new (capped) `pro` tier. Bump any that
-- should stay uncapped to `unlimited` manually after this migration.
UPDATE "User" SET "plan" = 'pro' WHERE "isPro" = true;

ALTER TABLE "User" DROP COLUMN "isPro";
