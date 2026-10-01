/*
  Warnings:

  - You are about to drop the column `hasUncommittedFiles` on the `Chat` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Chat" DROP COLUMN "hasUncommittedFiles",
ADD COLUMN     "uncommittedFilesCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProviderPricing" ALTER COLUMN "updatedAt" DROP DEFAULT;
