-- Pinned chats sort to the top of the sidebar and command palettes. Unlike
-- archiving, pinning is a per-chat preference and does not cascade to branches.
ALTER TABLE "Chat" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
