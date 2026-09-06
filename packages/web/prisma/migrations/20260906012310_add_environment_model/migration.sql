-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "environmentId" TEXT;

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "networkMode" TEXT NOT NULL DEFAULT 'full',
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environmentVariables" JSONB,
    "setupScript" TEXT,
    "setupScriptPrevious" TEXT,
    "setupScriptUpdatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Environment_userId_repo_idx" ON "Environment"("userId", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_userId_repo_name_key" ON "Environment"("userId", "repo", "name");

-- AddForeignKey
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one default environment per (userId, repo). Prisma can't express a
-- partial unique index, so it goes in by hand — same as the
-- McpServerConnection CHECK constraint.
CREATE UNIQUE INDEX "Environment_one_default_per_repo"
    ON "Environment"("userId", "repo")
    WHERE "isDefault";

-- Backfill: one "Default" environment per repo that already has variables in
-- User.repoEnvironmentVariables. The ciphertext is copied verbatim — no
-- decrypt/re-encrypt round trip, so values never exist in plaintext here and
-- the app's decrypt() reads them unchanged.
INSERT INTO "Environment" (
    "id", "userId", "repo", "name", "isDefault",
    "networkMode", "allowedDomains", "environmentVariables",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    u."id",
    repo.key,
    'Default',
    true,
    'full',
    ARRAY[]::text[],
    repo.value,
    NOW(),
    NOW()
FROM "User" u,
     jsonb_each(u."repoEnvironmentVariables"::jsonb) AS repo(key, value)
WHERE u."repoEnvironmentVariables" IS NOT NULL
  AND jsonb_typeof(u."repoEnvironmentVariables"::jsonb) = 'object';
