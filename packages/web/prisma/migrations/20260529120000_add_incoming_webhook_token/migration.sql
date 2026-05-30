-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN "incomingToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_incomingToken_key" ON "ScheduledJob"("incomingToken");
