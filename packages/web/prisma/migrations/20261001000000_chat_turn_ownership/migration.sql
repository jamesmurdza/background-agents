ALTER TABLE "Chat"
ADD COLUMN "activeAssistantMessageId" TEXT,
ADD COLUMN "finalizationClaimId" TEXT,
ADD COLUMN "finalizationClaimedAt" TIMESTAMP(3);

-- Existing running chats need the same ownership check after deployment.
UPDATE "Chat" AS chat
SET "activeAssistantMessageId" = (
  SELECT message.id
  FROM "Message" AS message
  WHERE message."chatId" = chat.id AND message.role = 'assistant'
  ORDER BY message.timestamp DESC, message."createdAt" DESC
  LIMIT 1
)
WHERE chat.status = 'running' AND chat."backgroundSessionId" IS NOT NULL;
