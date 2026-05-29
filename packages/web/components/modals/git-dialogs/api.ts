/**
 * Wrappers around the /api/sandbox/git endpoint, used by the git-dialogs hook.
 *
 * The endpoint is action-dispatched — every request goes to the same URL with
 * an "action" discriminator. Rather than make each handler in useGitDialogs
 * repeat the fetch/headers/JSON.stringify dance, we route through callSandboxGit
 * here. The caller still owns response interpretation (409-vs-error vs success,
 * which dialog state to clear, etc.) because that varies per action.
 */

/** All supported actions on /api/sandbox/git. Must match the route handler. */
export type SandboxGitAction =
  | "merge"
  | "rebase"
  | "force-push"
  | "abort-merge"
  | "abort-rebase"
  | "check-rebase-status"

export interface SandboxGitResult<T = unknown> {
  /** True iff HTTP 2xx. */
  ok: boolean
  /** Raw HTTP status — needed so callers can distinguish 409 conflict from 5xx error. */
  status: number
  /** Parsed JSON body. Empty object if the response wasn't valid JSON. */
  data: T
}

interface SandboxGitBody {
  sandboxId: string
  repoPath: string
  action: SandboxGitAction
}

/**
 * POST to /api/sandbox/git. Each action has its own payload shape (merge needs
 * targetBranch/squash/etc., abort-rebase needs almost nothing). The base
 * `sandboxId` + `repoPath` + `action` triplet is required; the rest spreads
 * straight onto the request body.
 *
 * Errors are *not* thrown — a non-OK response still returns a `SandboxGitResult`
 * with `ok: false` so the caller can inspect `status` and `data`.
 */
export async function callSandboxGit<T = unknown>(
  body: SandboxGitBody & Record<string, unknown>
): Promise<SandboxGitResult<T>> {
  const res = await fetch("/api/sandbox/git", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T
  return { ok: res.ok, status: res.status, data }
}
