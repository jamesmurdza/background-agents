import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import path from "path";
import fs from "fs";
import { settings } from "./git-sync-settings.js";

// =============================================================================
// isomorphic-git plumbing: clone/fetch/checkout a repo without the system
// `git` binary, and the local-path/URL helpers it needs.
// =============================================================================

/** Raised when an update would destroy unexpected local changes. */
export class DivergenceError extends Error {
  constructor(public branch: string) {
    super(
      `Your local copy of "${branch}" has uncommitted changes that differ from the cloud. ` +
        `Sync was skipped to avoid overwriting your work.`
    );
    this.name = "DivergenceError";
  }
}

/** Local on-disk path for a repo ("owner/name" → <root>/<name>). */
export function repoDir(repo: string): string {
  const name = repo.split("/").pop() || repo;
  return path.join(settings.rootDirectory, name);
}

export function repoUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

export function isCloned(repo: string): boolean {
  return fs.existsSync(path.join(repoDir(repo), ".git"));
}

function authCallback(token: string) {
  return () => ({ username: token, password: "x-oauth-basic" });
}

/**
 * True when no *tracked* file has been modified or deleted in the working tree.
 *
 * Untracked files are intentionally ignored: once the user runs the project
 * locally they'll have node_modules, build output, etc., and those must not
 * block syncing. We only guard against losing edits to tracked files.
 */
async function isWorkingTreeClean(dir: string): Promise<boolean> {
  const matrix = await git.statusMatrix({ fs, dir });
  // Row shape: [filepath, HEAD, workdir, stage].
  // HEAD === 1 means the file is tracked; workdir !== 1 means it differs from HEAD.
  return !matrix.some(([, head, workdir]) => head === 1 && workdir !== 1);
}

export async function currentBranch(dir: string): Promise<string | undefined> {
  return (await git.currentBranch({ fs, dir, fullname: false })) || undefined;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "NotFoundError";
}

/** The oid of a branch on origin, or null if origin has no such branch. */
export async function remoteOid(dir: string, branch: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });
  } catch {
    return null;
  }
}

/** Whether a local branch ref already exists. */
export async function hasLocalBranch(dir: string, branch: string): Promise<boolean> {
  try {
    await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reconcile a local branch ref with an already-fetched remote oid.
 *
 * - Moves the local branch ref to `target` (fast-forward or, for a force-push,
 *   reset). This never touches the working tree unless the branch is the one
 *   currently checked out, or `checkout` is requested.
 * - When the working tree WOULD be overwritten (checked-out branch or an
 *   explicit checkout) and a tracked file is modified, throws DivergenceError.
 */
export async function reconcileBranch(
  dir: string,
  branch: string,
  target: string,
  checkout: boolean
): Promise<void> {
  let local: string | null = null;
  try {
    local = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
  } catch {
    local = null;
  }

  const checkedOut = (await currentBranch(dir)) === branch;
  // The working tree changes when we check out a different branch, or when we
  // move the ref of the branch that is currently checked out.
  const touchesWorkingTree = checkout || checkedOut;

  if (local === target) {
    if (checkout && !checkedOut) await safeCheckout(dir, branch);
    return;
  }

  if (touchesWorkingTree && !(await isWorkingTreeClean(dir))) {
    throw new DivergenceError(branch);
  }

  await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: target, force: true });
  if (touchesWorkingTree) {
    await git.checkout({ fs, dir, ref: branch, force: true });
  }
}

/**
 * Fetch a single branch from origin and reconcile the local ref. Returns false
 * if the branch doesn't exist on origin (e.g. a chat that never pushed).
 */
export async function fetchAndReconcile(
  dir: string,
  url: string,
  token: string,
  branch: string,
  checkout: boolean
): Promise<boolean> {
  let fetchHead: string | null = null;
  try {
    const res = await git.fetch({
      fs,
      http,
      dir,
      url,
      ref: branch,
      singleBranch: true,
      tags: false,
      onAuth: authCallback(token),
    });
    fetchHead = res.fetchHead ?? null;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
  if (!fetchHead) return false;
  await reconcileBranch(dir, branch, fetchHead, checkout);
  return true;
}

/** Check out a branch, refusing to clobber a dirty working tree. */
export async function safeCheckout(dir: string, branch: string): Promise<void> {
  if ((await currentBranch(dir)) === branch) return;
  if (!(await isWorkingTreeClean(dir))) {
    throw new DivergenceError(branch);
  }
  await git.checkout({ fs, dir, ref: branch, force: true });
}

/** Clone a repo (every remote branch) into `dir`. */
export async function cloneRepo(dir: string, url: string, token: string): Promise<void> {
  await git.clone({ fs, http, dir, url, singleBranch: false, onAuth: authCallback(token) });
}
