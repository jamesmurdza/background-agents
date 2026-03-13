-- Add unread field to Branch (defaults to false, existing rows will be false)
ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "unread" BOOLEAN DEFAULT false;

-- Set NOT NULL constraint after adding with default
ALTER TABLE "Branch" ALTER COLUMN "unread" SET NOT NULL;
