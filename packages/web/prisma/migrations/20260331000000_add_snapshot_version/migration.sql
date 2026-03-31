-- Add snapshotVersion column for optimistic concurrency control.
-- This monotonic counter is incremented on each snapshot update,
-- allowing clients to detect and reject stale responses.
ALTER TABLE "AgentExecution" ADD COLUMN "snapshotVersion" INTEGER NOT NULL DEFAULT 0;
