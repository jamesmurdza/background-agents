ALTER TABLE "Chat"
ADD COLUMN "queuePaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "queueSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "queueDispatchId" TEXT;

CREATE TABLE "QueuedPrompt" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "clientId" TEXT,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "userMessageId" TEXT NOT NULL,
    "assistantMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueuedPrompt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QueuedPrompt_userMessageId_key" ON "QueuedPrompt"("userMessageId");
CREATE UNIQUE INDEX "QueuedPrompt_assistantMessageId_key" ON "QueuedPrompt"("assistantMessageId");
CREATE UNIQUE INDEX "QueuedPrompt_chatId_clientId_key" ON "QueuedPrompt"("chatId", "clientId");
CREATE UNIQUE INDEX "QueuedPrompt_chatId_position_key" ON "QueuedPrompt"("chatId", "position");
CREATE INDEX "QueuedPrompt_chatId_status_position_idx" ON "QueuedPrompt"("chatId", "status", "position");

ALTER TABLE "QueuedPrompt" ADD CONSTRAINT "QueuedPrompt_chatId_fkey"
FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
