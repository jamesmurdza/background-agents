/**
 * Auto-pull a chat's branch before an agent run.
 *
 * A chat is tied to a git branch living in a Daytona sandbox. The agent only
 * pushes at the *end* of a turn, so commits pushed to the branch from elsewhere
 * (a local checkout, another chat, the GitHub UI) are invisible to the sandbox
 * until we pull them in. This helper fetches the branch and, when the sandbox is
 * behind origin, merges the remote commits before the agent starts.
 *
 * Conflict handling is driven by `mode` (chosen by the user via the pull-conflict
 * dialog). See {@link AutoPullResult} for the per-mode outcomes.
 *
 * The git plumbing mirrors the merge/rebase conflict detection already used in
 * `app/api/sandbox/git/route.ts` and the `isInConflictState` check in
 * `app/api/agent/stream/route.ts`.
 */

import {
  createSandboxGit,
  shellEscape as esc,
  type SandboxLike,
} from "@background-agents/daytona-git"

export type AutoPullResult =
  /** Nothing to do — branch already matches origin. */
  | { status: "up-to-date" }
  /** Remote commits were merged cleanly. `commits` = how many were behind. */
  | { status: "pulled"; commits: number }
  /**
   * A merge is **in progress** with conflicts. The sandbox is left in exactly
   * the same state as a conflicted merge/rebase, so the existing conflict UI
   * (`check-rebase-status` → header indicator + Abort Merge) picks it up.
   *
   * `alreadyInProgress` distinguishes the two callers:
   * - `false` — *this* call started the merge and it conflicted. The route
   *   blocks the run and surfaces the conflict so the user can decide.
   * - `true` — a merge from a prior conflicted pull was still in progress when
   *   the user sent another message. The route lets the agent run (on the
   *   conflicted tree) so it can resolve the conflict as part of the turn.
   */
  | { status: "conflict"; conflictedFiles: string[]; alreadyInProgress: boolean }
  /**
   * The pull could not be applied for a reason that isn't a content conflict
   * (e.g. a `git` error). The agent runs on the un-pulled tree; the end-of-turn
   * push then surfaces the divergence. `message` is the raw git output.
   */
  | { status: "error"; message: string }

/**
 * Install a `pre-commit` hook that blocks commits containing unresolved conflict
 * markers, so the agent can't accidentally `git add -A && git commit` the markers
 * and silently finalize a conflicted merge (which would clear `MERGE_HEAD` and
 * drop us out of conflict state). `git diff --cached --check` is git's built-in
 * detector for staged conflict markers. Idempotent — safe to re-run every turn.
 */
async function installConflictMarkerHook(
  sandbox: SandboxLike,
  repoPath: string
): Promise<void> {
  const hookPath = `${esc(repoPath)}/.git/hooks/pre-commit`
  await sandbox.process.executeCommand(
    `cat > ${hookPath} <<'HOOK' && chmod +x ${hookPath}\n` +
      `#!/bin/sh\n` +
      `markers=$(git diff --cached --check 2>/dev/null | grep -i 'conflict marker')\n` +
      `if [ -n "$markers" ]; then\n` +
      `  echo "Commit blocked — unresolved conflict markers:" >&2\n` +
      `  echo "$markers" >&2\n` +
      `  exit 1\n` +
      `fi\n` +
      `HOOK`
  )
}

/** Whether a merge is currently in progress in the repo. */
async function isMergeInProgress(
  sandbox: SandboxLike,
  repoPath: string
): Promise<boolean> {
  const check = await sandbox.process.executeCommand(
    `test -f ${esc(repoPath)}/.git/MERGE_HEAD && echo "yes" || echo "no"`
  )
  return check.result.trim() === "yes"
}

/** List the files with unresolved merge conflicts. */
async function conflictedFiles(
  sandbox: SandboxLike,
  repoPath: string
): Promise<string[]> {
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git diff --name-only --diff-filter=U 2>&1`
  )
  return res.result.trim().split("\n").filter(Boolean)
}

/** Short SHA of the current HEAD (empty string if it can't be read). */
async function head(sandbox: SandboxLike, repoPath: string): Promise<string> {
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git rev-parse --short HEAD 2>/dev/null || echo ""`
  )
  return res.result.trim()
}

/** Porcelain status output — empty when the working tree is clean. */
async function dirtyStatus(sandbox: SandboxLike, repoPath: string): Promise<string> {
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git status --porcelain 2>&1`
  )
  return res.result.trim()
}

/** Number of commits the local branch is behind origin/<branch>. */
async function commitsBehind(
  sandbox: SandboxLike,
  repoPath: string,
  branch: string
): Promise<number> {
  // left = commits in origin/<branch> not in HEAD (behind); right = ahead.
  const res = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git rev-list --left-right --count origin/${esc(branch)}...HEAD 2>/dev/null || echo "0 0"`
  )
  const behind = parseInt(res.result.trim().split(/\s+/)[0] || "0", 10)
  return Number.isNaN(behind) ? 0 : behind
}

/**
 * Merge origin/<branch> into the current branch.
 *
 * We deliberately do NOT use `--autostash`. An autostash re-apply conflict
 * leaves conflict markers in the working tree but *no* `MERGE_HEAD` — so it's
 * invisible to the `MERGE_HEAD`-based conflict checks and can't be aborted with
 * `git merge --abort`. Instead, if the working tree is dirty we **commit the WIP
 * first**, then run a normal merge. That turns any conflict into a genuine
 * 3-way merge conflict with `MERGE_HEAD` set, which the existing conflict UI,
 * the auto-push skip, the pre-commit hook, and the Abort Merge button all handle
 * correctly. The outcome is decided authoritatively:
 *   - unresolved conflicts present  → "conflict" (merge left in progress)
 *   - HEAD did not advance, no conflict → "error" (the merge failed; we don't
 *     pretend it pulled)
 *   - HEAD advanced                 → "pulled"
 */
async function mergeRemote(
  sandbox: SandboxLike,
  repoPath: string,
  branch: string,
  behind: number
): Promise<AutoPullResult> {
  const dirty = await dirtyStatus(sandbox, repoPath)
  if (dirty) {
    // Commit the agent's uncommitted WIP so the pull is a real, abortable merge
    // rather than an autostash pop. No markers exist yet (nothing is merged), so
    // the pre-commit hook passes.
    const wipRes = await sandbox.process.executeCommand(
      `cd ${esc(repoPath)} && git add -A && git commit --no-edit -m "Auto-saved WIP before pulling origin/${esc(branch)}" 2>&1`
    )
    if (wipRes.exitCode !== 0) {
      return { status: "error", message: wipRes.result.trim() || "failed to commit WIP before pull" }
    }
  }

  const before = await head(sandbox, repoPath)
  const mergeRes = await sandbox.process.executeCommand(
    `cd ${esc(repoPath)} && git merge --no-edit origin/${esc(branch)} 2>&1`
  )
  const after = await head(sandbox, repoPath)

  // A real merge conflict leaves unmerged paths and MERGE_HEAD in place.
  const conflicts = await conflictedFiles(sandbox, repoPath)
  if (conflicts.length > 0 || (await isMergeInProgress(sandbox, repoPath))) {
    return { status: "conflict", conflictedFiles: conflicts, alreadyInProgress: false }
  }

  // No conflict but HEAD didn't move → the merge did not apply. Report it
  // honestly instead of claiming a successful pull.
  if (after === before || mergeRes.exitCode !== 0) {
    return { status: "error", message: mergeRes.result.trim() || "merge did not advance HEAD" }
  }

  return { status: "pulled", commits: behind }
}

/**
 * Pull origin/<branch> into the sandbox before the agent runs.
 *
 * - If a merge is **already in progress** (a prior pull conflicted and the user
 *   is now sending a message to resolve it), report its conflicts with
 *   `alreadyInProgress: true` so the route lets the agent resolve them. We don't
 *   re-fetch or re-merge.
 * - Otherwise fetch origin/<branch>; if behind, merge. A clean merge → `pulled`;
 *   a conflict is left in progress with `alreadyInProgress: false` so the route
 *   blocks the run and surfaces the existing conflict UI.
 *
 * Aborting a conflicted pull is handled by the existing `abort-merge` git action
 * (the header "Abort Merge" button), not here.
 *
 * The caller is responsible for guarding callers that shouldn't pull at all
 * (freshly created sandbox, no remote branch, no GitHub token).
 */
export async function autoPullBeforeRun(
  sandbox: SandboxLike,
  repoPath: string,
  branch: string,
  token: string
): Promise<AutoPullResult> {
  // Guard against the agent committing unresolved conflict markers (which would
  // silently finalize a conflicted merge and drop us out of conflict state).
  await installConflictMarkerHook(sandbox, repoPath)

  // Already in conflict — either a merge left in progress by a prior conflicted
  // pull, or unmerged paths still sitting in the index (e.g. an older sandbox
  // left in the autostash-orphan state). The user is sending a message to have
  // the agent resolve it. Surface the conflicts as-is and DON'T pull more on top
  // of unresolved markers (a fresh WIP commit would also be blocked by the
  // pre-commit hook). The agent runs on the conflicted tree.
  const existingConflicts = await conflictedFiles(sandbox, repoPath)
  if (existingConflicts.length > 0 || (await isMergeInProgress(sandbox, repoPath))) {
    return { status: "conflict", conflictedFiles: existingConflicts, alreadyInProgress: true }
  }

  const git = createSandboxGit(sandbox)
  // Ensures origin/<branch> exists even for single-branch clones.
  await git.fetchBranch(repoPath, branch, token)

  const behind = await commitsBehind(sandbox, repoPath, branch)
  if (behind === 0) {
    return { status: "up-to-date" }
  }

  return mergeRemote(sandbox, repoPath, branch, behind)
}
