-- CreateTable
CREATE TABLE "TokenUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "messageId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "pool" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "coverage" DOUBLE PRECISION,
    "sessionId" TEXT NOT NULL,
    "cumulativeTotal" INTEGER NOT NULL DEFAULT 0,
    "cumulativeCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenUsage_userId_provider_pool_createdAt_idx" ON "TokenUsage"("userId", "provider", "pool", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_userId_createdAt_idx" ON "TokenUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_provider_createdAt_idx" ON "TokenUsage"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "TokenUsage_sessionId_model_createdAt_idx" ON "TokenUsage"("sessionId", "model", "createdAt");

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
