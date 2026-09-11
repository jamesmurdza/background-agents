-- Admin-editable pricing multiplier per provider, replacing the hardcoded
-- DISCOUNT_DIVISOR constant in lib/server/credits.
--
-- Multiplier, not divisor: chargeable = costUsd * multiplier. A row absent
-- from this table charges at 1 (list value); a multiplier of exactly 0 makes
-- the provider free (see lib/db/provider-pricing).
--
-- Seeded with the multipliers equivalent to the constants this replaces
-- (1/20, 1/2, 1/2), so behavior does not change the moment this ships — an
-- admin can move them from the new panel from here on.

CREATE TABLE "ProviderPricing" (
    "provider"   TEXT NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy"  TEXT,

    CONSTRAINT "ProviderPricing_pkey" PRIMARY KEY ("provider")
);

INSERT INTO "ProviderPricing" ("provider", "multiplier") VALUES
    ('claude', 0.05),
    ('opencode', 0.5),
    ('gemini', 0.5);
