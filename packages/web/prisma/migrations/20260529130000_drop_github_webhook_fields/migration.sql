-- Consolidate the GitHub-Actions-specific "webhook" trigger into the generic
-- "incoming" trigger. Any existing webhook-triggered jobs are converted to
-- incoming with a NULL token — the user must rotate from the form to mint a
-- new URL. The GitHub-side webhook itself is left in place (it'll start
-- 404ing once /api/webhooks/github is deleted in the same release).

UPDATE "ScheduledJob"
SET "triggerType" = 'incoming',
    "incomingToken" = NULL
WHERE "triggerType" = 'webhook';

-- Drop the now-unused GitHub-webhook bookkeeping columns.
ALTER TABLE "ScheduledJob" DROP COLUMN "githubWebhookId";
ALTER TABLE "ScheduledJob" DROP COLUMN "webhookSecret";
