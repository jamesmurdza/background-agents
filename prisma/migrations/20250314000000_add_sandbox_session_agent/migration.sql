-- AlterTable: store which agent created the session so we start a new session when agent changes
ALTER TABLE "Sandbox" ADD COLUMN IF NOT EXISTS "sessionAgent" TEXT;
