-- CreateTable
CREATE TABLE "ChatMcpServer" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "qualifiedName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "iconUrl" TEXT,
    "smitheryConnectionId" TEXT NOT NULL,
    "smitheryNamespace" TEXT NOT NULL,
    "mcpUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMcpServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMcpServer_chatId_qualifiedName_key" ON "ChatMcpServer"("chatId", "qualifiedName");

-- CreateIndex
CREATE INDEX "ChatMcpServer_chatId_idx" ON "ChatMcpServer"("chatId");

-- AddForeignKey
ALTER TABLE "ChatMcpServer" ADD CONSTRAINT "ChatMcpServer_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
