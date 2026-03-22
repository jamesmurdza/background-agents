ALTER TABLE "AgentExecution"
ADD COLUMN IF NOT EXISTS "completionHandledAt" TIMESTAMP(3);
