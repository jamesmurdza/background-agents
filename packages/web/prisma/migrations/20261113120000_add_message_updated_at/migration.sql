-- Tracks the last write to each message (the running assistant reply is
-- rewritten in place while the agent works), so GET /api/chats/[chatId]
-- can return only messages changed since the client's last sync
-- (?changedSince=) instead of the whole history. Existing rows get the
-- migration time, which only means one extra full sync per open chat.
ALTER TABLE "Message" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "Message_chatId_updatedAt_idx" ON "Message"("chatId", "updatedAt");
