-- AlterTable
ALTER TABLE "ScheduledJob" ADD COLUMN     "continueFromLastRun" BOOLEAN NOT NULL DEFAULT false;
