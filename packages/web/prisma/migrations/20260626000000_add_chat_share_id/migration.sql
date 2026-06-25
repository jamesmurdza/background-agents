-- Public sharing: an unguessable token that makes a chat viewable read-only at
-- /share/<shareId> without authentication. Null = private.
ALTER TABLE "Chat" ADD COLUMN "shareId" TEXT;

-- Unique so a shareId maps to exactly one chat.
CREATE UNIQUE INDEX "Chat_shareId_key" ON "Chat"("shareId");
