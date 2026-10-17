-- Nullable and additive: existing queued prompts retain runtime defaults.
ALTER TABLE "QueuedPrompt" ADD COLUMN "thinking" TEXT;
