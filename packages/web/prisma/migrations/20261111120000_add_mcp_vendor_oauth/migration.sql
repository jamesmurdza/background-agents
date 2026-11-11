-- CreateTable
CREATE TABLE "McpOAuthClient" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT,
    "authMethod" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpOAuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpOAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthClient_vendor_redirectUri_key" ON "McpOAuthClient"("vendor", "redirectUri");

-- CreateIndex
CREATE UNIQUE INDEX "McpOAuthToken_userId_vendor_key" ON "McpOAuthToken"("userId", "vendor");

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

