-- Admin-editable max agent run duration, replacing the hardcoded
-- INTERACTIVE_HARD_TIMEOUT/SCHEDULED_HARD_TIMEOUT constants in
-- app/api/cron/agent-lifecycle/_lib/constants.
--
-- Singleton row (id fixed at 1): these are process-wide limits enforced by
-- the agent-lifecycle cron, not per-user/provider. No row is seeded here —
-- an absent row means "use the hardcoded defaults" (see
-- lib/db/agent-run-limits) — so behavior does not change until an admin sets
-- a value from the new /admin Development panel.

CREATE TABLE "AgentRunLimits" (
    "id"                 INTEGER NOT NULL DEFAULT 1,
    "interactiveMinutes" INTEGER NOT NULL,
    "scheduledMinutes"   INTEGER NOT NULL,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy"          TEXT,

    CONSTRAINT "AgentRunLimits_pkey" PRIMARY KEY ("id")
);
