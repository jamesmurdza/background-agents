-- One table for every user's MCP logins, and Smithery removed.
--
-- McpCredential holds a user's link to each integration: their GitHub App
-- installation, their Google refresh token for Gmail, and their OAuth tokens
-- for vendor-hosted servers (Linear, Notion, Paddle, ...). GitHub and Gmail
-- links move here from User. Paddle logins are not copied: Paddle is now a
-- regular vendor with its own registered client, so Paddle users connect again.
-- Smithery connections are deleted along with their columns.
--
-- Wrapped in a transaction because Prisma doesn't roll back a migration that
-- fails halfway; this way a failure leaves the database as it was.

BEGIN;

-- 1. OAuth clients we registered with each vendor (one per redirect URI).
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

CREATE UNIQUE INDEX "McpOAuthClient_vendor_redirectUri_key" ON "McpOAuthClient"("vendor", "redirectUri");

-- 2. Credentials, one per user and provider.
CREATE TABLE "McpCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "installationId" TEXT,
    "refreshTokenEncrypted" TEXT,
    "accessTokenEncrypted" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshLockedUntil" TIMESTAMP(3),
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpCredential_userId_provider_key" ON "McpCredential"("userId", "provider");

ALTER TABLE "McpCredential" ADD CONSTRAINT "McpCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "McpCredential" ADD CONSTRAINT "McpCredential_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpOAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Move GitHub installations and Gmail refresh tokens out of User.
INSERT INTO "McpCredential" ("id", "userId", "provider", "installationId", "updatedAt")
SELECT 'github_' || "id", "id", 'github', "githubAppInstallationId", CURRENT_TIMESTAMP
FROM "User"
WHERE "githubAppInstallationId" IS NOT NULL;

INSERT INTO "McpCredential" ("id", "userId", "provider", "refreshTokenEncrypted", "updatedAt")
SELECT 'gmail_' || "id", "id", 'gmail', "googleRefreshTokenEncrypted", CURRENT_TIMESTAMP
FROM "User"
WHERE "googleRefreshTokenEncrypted" IS NOT NULL;

-- 4. Drop Smithery connections. Every row Smithery created has a connection id.
DELETE FROM "McpServerConnection" WHERE "smitheryConnectionId" IS NOT NULL;

-- 5. Drop the old columns.
ALTER TABLE "User" DROP COLUMN "githubAppInstallationId",
DROP COLUMN "googleRefreshTokenEncrypted",
DROP COLUMN "paddleRefreshTokenEncrypted";

ALTER TABLE "McpServerConnection" DROP COLUMN "encryptedApiKey",
DROP COLUMN "smitheryConnectionId",
DROP COLUMN "smitheryNamespace";

COMMIT;
