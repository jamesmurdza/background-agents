-- Unify ChatMcpServer + ScheduledJobMcpServer into a single
-- McpServerConnection table with two nullable FKs. Each FK keeps its own
-- ON DELETE CASCADE so deleting a chat or a job still drops its connections.
-- A CHECK constraint enforces that exactly one of (chatId, scheduledJobId)
-- is set per row, since Prisma can't model that.

-- 1. Create the new table.
CREATE TABLE "McpServerConnection" (
    "id" TEXT NOT NULL,
    "chatId" TEXT,
    "scheduledJobId" TEXT,
    "qualifiedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "iconUrl" TEXT,
    "smitheryConnectionId" TEXT,
    "smitheryNamespace" TEXT,
    "mcpUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpServerConnection_pkey" PRIMARY KEY ("id")
);

-- 2. CHECK: exactly one owner. (X XOR Y) expressed via inequality of nullness.
ALTER TABLE "McpServerConnection"
    ADD CONSTRAINT "McpServerConnection_exactly_one_owner"
    CHECK (("chatId" IS NULL) <> ("scheduledJobId" IS NULL));

-- 3. Indexes and unique constraints.
CREATE INDEX "McpServerConnection_chatId_idx" ON "McpServerConnection"("chatId");
CREATE INDEX "McpServerConnection_scheduledJobId_idx" ON "McpServerConnection"("scheduledJobId");
CREATE UNIQUE INDEX "McpServerConnection_chatId_qualifiedName_key" ON "McpServerConnection"("chatId", "qualifiedName");
CREATE UNIQUE INDEX "McpServerConnection_scheduledJobId_qualifiedName_key" ON "McpServerConnection"("scheduledJobId", "qualifiedName");

-- 4. Foreign keys with cascade. Each side stands on its own — the row dies
--    when its owner dies, regardless of whether the other column is set.
ALTER TABLE "McpServerConnection"
    ADD CONSTRAINT "McpServerConnection_chatId_fkey"
    FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "McpServerConnection"
    ADD CONSTRAINT "McpServerConnection_scheduledJobId_fkey"
    FOREIGN KEY ("scheduledJobId") REFERENCES "ScheduledJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Backfill from ChatMcpServer.
INSERT INTO "McpServerConnection" (
    "id", "chatId", "scheduledJobId",
    "qualifiedName", "displayName", "iconUrl",
    "smitheryConnectionId", "smitheryNamespace", "mcpUrl",
    "encryptedApiKey", "status", "lastError",
    "createdAt", "updatedAt"
)
SELECT
    "id", "chatId", NULL,
    "qualifiedName", "displayName", "iconUrl",
    "smitheryConnectionId", "smitheryNamespace", "mcpUrl",
    "encryptedApiKey", "status", "lastError",
    "createdAt", "updatedAt"
FROM "ChatMcpServer";

-- 6. Backfill from ScheduledJobMcpServer.
INSERT INTO "McpServerConnection" (
    "id", "chatId", "scheduledJobId",
    "qualifiedName", "displayName", "iconUrl",
    "smitheryConnectionId", "smitheryNamespace", "mcpUrl",
    "encryptedApiKey", "status", "lastError",
    "createdAt", "updatedAt"
)
SELECT
    "id", NULL, "jobId",
    "qualifiedName", "displayName", "iconUrl",
    "smitheryConnectionId", "smitheryNamespace", "mcpUrl",
    "encryptedApiKey", "status", "lastError",
    "createdAt", "updatedAt"
FROM "ScheduledJobMcpServer";

-- 7. Drop old tables (FK constraints come with them).
DROP TABLE "ChatMcpServer";
DROP TABLE "ScheduledJobMcpServer";
