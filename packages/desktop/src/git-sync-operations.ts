import { shell } from "electron";
import fs from "fs";
import { settings } from "./git-sync-settings.js";
import {
  DivergenceError,
  cloneRepo,
  fetchAndReconcile,
  hasLocalBranch,
  isCloned,
  reconcileBranch,
  remoteOid,
  repoDir,
  repoUrl,
  safeCheckout,
} from "./git-sync-git-ops.js";
import { emitError, emitStatus, getToken } from "./git-sync-runtime.js";

// =============================================================================
// Operations (each wrapped in the per-repo queue by the IPC handlers in
// git-sync.ts).
// =============================================================================

// The branch the user is currently viewing, per repo. Used so that when an
// agent finishes and pushes, we materialize (check out) the freshly-pushed
// branch into the working tree if it belongs to the active chat — even the very
// first time that branch is seen locally (a brand-new chat). Without this, a new
// chat's changes only appear after switching chats and back.
const activeBranchByRepo = new Map<string, string>();

export async function doOpenRepoFolder(
  repo: string,
  branches: string[],
  activeBranch: string | null
): Promise<void> {
  const dir = repoDir(repo);
  const url = repoUrl(repo);

  fs.mkdirSync(settings.rootDirectory, { recursive: true });

  if (isCloned(repo)) {
    // Already cloned — branches are kept fresh by push events, so opening is
    // just a local checkout of the active chat's branch + reveal the folder.
    // No network fetch here.
    emitStatus(repo, "syncing");
    try {
      if (activeBranch && (await hasLocalBranch(dir, activeBranch))) {
        await safeCheckout(dir, activeBranch);
      }
    } catch (error) {
      if (error instanceof DivergenceError) emitError(repo, activeBranch ?? "", error.message);
      else throw error;
    }
    emitStatus(repo, "ready");
    await shell.openPath(dir);
    return;
  }

  // First open: clone (fetches every remote branch in one shot), then create a
  // local ref for each agent branch that exists on origin — straight from the
  // remote-tracking refs the clone populated, no extra network calls. Check out
  // only the active one. Branches that never pushed are skipped quietly.
  const token = await getToken();
  emitStatus(repo, "cloning");
  fs.mkdirSync(dir, { recursive: true });
  await cloneRepo(dir, url, token);

  emitStatus(repo, "syncing");
  const wanted = Array.from(new Set(branches.filter(Boolean)));
  for (const branch of wanted) {
    const target = await remoteOid(dir, branch);
    if (!target) continue; // not on origin yet (chat hasn't pushed)
    try {
      await reconcileBranch(dir, branch, target, branch === activeBranch);
    } catch (error) {
      if (error instanceof DivergenceError) {
        emitError(repo, branch, error.message);
      } else {
        console.warn(`[git-sync] Could not update branch "${branch}" for ${repo}:`, error);
      }
    }
  }

  // If the active branch couldn't be checked out (e.g. not pushed yet), the
  // clone's default branch stays in the working tree — that's fine.
  emitStatus(repo, "ready");
  await shell.openPath(dir);
}

export async function doSetActiveChat(repo: string, branch: string | null): Promise<void> {
  if (!branch || !isCloned(repo)) return; // only act on opted-in repos
  activeBranchByRepo.set(repo, branch);
  const dir = repoDir(repo);
  const url = repoUrl(repo);
  emitStatus(repo, "syncing");
  try {
    if (await hasLocalBranch(dir, branch)) {
      // Ref is kept fresh by push events — just switch the working tree locally.
      await safeCheckout(dir, branch);
    } else {
      // First time we've seen this branch locally — fetch it once to self-heal.
      const token = await getToken();
      await fetchAndReconcile(dir, url, token, branch, true);
    }
    emitStatus(repo, "ready");
  } catch (error) {
    handleOpError(repo, branch, error);
  }
}

export async function doSyncBranch(repo: string, branch: string): Promise<void> {
  if (!branch || !isCloned(repo)) return; // only act on opted-in repos
  const dir = repoDir(repo);
  const url = repoUrl(repo);
  emitStatus(repo, "syncing");
  try {
    const token = await getToken();
    // Update this branch's ref. Materialize (check out) it when it's the branch
    // the user is currently viewing, so a just-finished agent's changes land in
    // the working tree immediately — even the first time this branch is seen
    // locally (a brand-new chat). Otherwise `reconcileBranch` only moves the ref
    // if the branch already happens to be checked out.
    const isActive = activeBranchByRepo.get(repo) === branch;
    await fetchAndReconcile(dir, url, token, branch, isActive);
    emitStatus(repo, "ready");
  } catch (error) {
    handleOpError(repo, branch, error);
  }
}

function handleOpError(repo: string, branch: string, error: unknown): void {
  if (error instanceof DivergenceError) {
    emitStatus(repo, "ready");
    emitError(repo, branch, error.message);
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  emitStatus(repo, "error", message);
  emitError(repo, branch, `Failed to sync ${repo}: ${message}`);
}
