-- AlterTable: status-driven polling (serverless) - throttle and event accumulation
ALTER TABLE "AgentExecution" ADD COLUMN "lastSnapshotPolledAt" TIMESTAMP(3),
ADD COLUMN "accumulatedEvents" JSONB;
