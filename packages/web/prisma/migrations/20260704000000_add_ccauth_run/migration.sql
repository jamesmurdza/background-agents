-- Audit log of every Claude credential refresh attempt (cron + admin panel).
-- Powers the "Credentials" admin tab: refresh history, durations, and failures.

-- CreateTable
CREATE TABLE "CcAuthRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "code" TEXT,
    "message" TEXT,
    "trigger" TEXT NOT NULL,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "cookiesUpdated" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CcAuthRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CcAuthRun_createdAt_idx" ON "CcAuthRun"("createdAt");
