# Queue wake-up race evidence (issue #452)

These screenshots come from `packages/web/e2e/prompt-queue-live-race.spec.ts`
on the fixed branch. Both show the same local test chat.

- `before-live-dispatch.png`: a prompt is queued before eight browser wake-up
  requests and one cron request are sent concurrently. The test temporarily
  stubs the browser's automatic wake-up to capture this state. This is **not**
  a screenshot of the old code.
- `after-live-dispatch.png`: the Eliza turn has completed and the queue has
  cleared. The test separately checks that only one request started the turn,
  exactly one user/assistant message pair was added, and the SSE stream
  completed.

The old-code regression is demonstrated by the Playwright assertion that
observed zero browser wake-up requests after a completed turn. These images
show the local queued-to-completed transition, not production behavior or an
exactly-once guarantee across worker crashes.
