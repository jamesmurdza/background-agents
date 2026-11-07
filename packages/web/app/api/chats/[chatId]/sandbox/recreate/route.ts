/**
 * POST /api/chats/[chatId]/sandbox/recreate
 *
 * Explicit recovery path for a sandbox that Daytona auto-deleted (the preview
 * panel's "expired" state — see `lib/sandbox-lifecycle.ts`). The agent-message
 * route (`ensure-sandbox.ts`) already recreates a dead sandbox transparently
 * whenever the user sends a new message; this route exposes the *same*
 * recreation path directly to the preview panel, so clicking refresh on an
 * expired preview doesn't require going back to the chat and sending a message
 * first — it only re-probed the same gone sandboxId forever, which can never
 * succeed (see `/api/sandbox/state`, which never creates anything).
 *
 * Restores the chat's existing branch (if it has one) so the recreated
 * sandbox picks up where the old one left off, same as a first message after
 * deletion would. Dev-server restart recipes live on the chat row, keyed by
 * current sandboxId (see `lib/db/dev-servers-store.ts`), so they carry over
 * automatically once this updates `chat.sandboxId` — a follow-up explicit
 * refresh of the server-preview panel can still replay the dev server command.
 *
 * Behaviorally identical to `/api/chats/[chatId]/sandbox/ensure` (both reuse
 * an existing live sandbox or create one via `ensureSandboxRunning`) — this
 * route exists only so the preview panel has a URL that matches its mental
 * model of "recreate", while reusing the same shared handler.
 *
 * Body: {} (chatId comes from the route param)
 * Responses:
 *   200 { sandboxId, previewUrlPattern, branch }
 *   404 — chat not found / not owned by caller
 *   410 { error: "SANDBOX_NOT_FOUND" } — cloned repo with no GitHub token to
 *     reclone (the one genuinely unrecoverable case, same as ensure-sandbox.ts)
 */
export { POST } from "../ensure/route"
