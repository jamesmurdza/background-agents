import { ipcMain, Notification, app, dialog, shell, BrowserWindow } from "electron";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import path from "path";
import fs from "fs";

// =============================================================================
// Local repo sync (Backgrounder folder) — pure-Electron, one-way (cloud → local)
//
// All git operations run through isomorphic-git (no system `git` binary). The
// renderer orchestrates (it knows the chats / repos / branches); this module is
// the git executor. Only repos the user has explicitly opened (cloned under the
// root folder) are auto-synced — every handler no-ops for a repo that isn't
// cloned yet.
// =============================================================================

interface GitSyncSettings {
  /** Root folder that holds all locally-synced Backgrounder repos. */
  rootDirectory: string;
}

type RepoSyncState = "idle" | "cloning" | "syncing" | "ready" | "error";

interface SetupOptions {
  /** Returns the current main window (used for events, dialogs, and the auth session). */
  getWindow: () => BrowserWindow | null;
  /** Base URL of the web backend (used to mint the GitHub token). */
  backendUrl: string;
}

const SETTINGS_FILE = "git-sync-settings.json";

function defaultRootDirectory(): string {
  // app.getPath("home") resolves to ~ on macOS/Linux and %USERPROFILE% on Windows.
  return path.join(app.getPath("home"), "Backgrounder");
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

let settings: GitSyncSettings = { rootDirectory: defaultRootDirectory() };
let opts: SetupOptions | null = null;

function loadSettings(): void {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<GitSyncSettings>;
    if (parsed.rootDirectory && typeof parsed.rootDirectory === "string") {
      settings.rootDirectory = parsed.rootDirectory;
    }
  } catch {
    // No persisted settings yet — keep the OS default.
  }
}

function persistSettings(): void {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.error("[git-sync] Failed to persist settings:", error);
  }
}

// -----------------------------------------------------------------------------
// Renderer notifications
// -----------------------------------------------------------------------------

function emitStatus(repo: string, status: RepoSyncState, message?: string): void {
  opts?.getWindow()?.webContents.send("sync-status", { repo, status, message });
}

function emitError(repo: string, branch: string | undefined, message: string): void {
  opts?.getWindow()?.webContents.send("sync-error", { repo, branch, message });
  new Notification({ title: "Local sync error", body: message }).show();
}

// -----------------------------------------------------------------------------
// Per-repo serial queue — never run two isomorphic-git ops on the same .git at
// once. Different repos run in parallel.
// -----------------------------------------------------------------------------

const repoQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(repo: string, task: () => Promise<T>): Promise<T> {
  const prev = repoQueues.get(repo) ?? Promise.resolve();
  // Run `task` after the previous op settles, regardless of its outcome.
  const next = prev.then(task, task);
  // Swallow rejection on the chained promise so the queue keeps flowing.
  repoQueues.set(
    repo,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next as Promise<T>;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Local on-disk path for a repo ("owner/name" → <root>/<name>). */
function repoDir(repo: string): string {
  const name = repo.split("/").pop() || repo;
  return path.join(settings.rootDirectory, name);
}

function repoUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

function isCloned(repo: string): boolean {
  return fs.existsSync(path.join(repoDir(repo), ".git"));
}

/** Raised when an update would destroy unexpected local changes. */
class DivergenceError extends Error {
  constructor(public branch: string) {
    super(
      `Your local copy of "${branch}" has uncommitted changes that differ from the cloud. ` +
        `Sync was skipped to avoid overwriting your work.`
    );
    this.name = "DivergenceError";
  }
}

/** Mint a short-lived GitHub token from the backend, scoped to the auth session. */
async function getToken(): Promise<string> {
  if (!opts) throw new Error("git-sync not initialized");
  const win = opts.getWindow();
  if (!win) throw new Error("No window available to fetch token");
  const res = await win.webContents.session.fetch(
    `${opts.backendUrl}/api/auth/github-sync-token`,
    { method: "POST" }
  );
  if (!res.ok) {
    throw new Error(`Could not get GitHub token (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("No GitHub token returned");
  return data.token;
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

async function currentBranch(dir: string): Promise<string | undefined> {
  return (await git.currentBranch({ fs, dir, fullname: false })) || undefined;
}

function isNotFound(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "NotFoundError";
}

/** The oid of a branch on origin, or null if origin has no such branch. */
async function remoteOid(dir: string, branch: string): Promise<string | null> {
  try {
    return await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` });
  } catch {
    return null;
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
async function reconcileBranch(
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
async function fetchAndReconcile(
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
async function safeCheckout(dir: string, branch: string): Promise<void> {
  if ((await currentBranch(dir)) === branch) return;
  if (!(await isWorkingTreeClean(dir))) {
    throw new DivergenceError(branch);
  }
  await git.checkout({ fs, dir, ref: branch, force: true });
}

// -----------------------------------------------------------------------------
// Operations (each wrapped in the per-repo queue by the IPC handlers)
// -----------------------------------------------------------------------------

async function doOpenRepoFolder(
  repo: string,
  branches: string[],
  activeBranch: string | null
): Promise<void> {
  const dir = repoDir(repo);
  const url = repoUrl(repo);

  fs.mkdirSync(settings.rootDirectory, { recursive: true });

  const token = await getToken();
  const onAuth = authCallback(token);

  if (!isCloned(repo)) {
    emitStatus(repo, "cloning");
    fs.mkdirSync(dir, { recursive: true });
    // singleBranch:false fetches every remote branch in one shot.
    await git.clone({ fs, http, dir, url, singleBranch: false, onAuth });
  } else {
    // One fetch-all updates every remote-tracking ref (no per-branch round trips).
    emitStatus(repo, "syncing");
    await git.fetch({ fs, http, dir, url, singleBranch: false, prune: true, tags: false, onAuth });
  }

  emitStatus(repo, "syncing");

  // Create/update a local ref for every agent branch that exists on origin,
  // straight from the remote-tracking refs the clone/fetch just populated — no
  // extra network calls. Check out only the active one. Branches that never
  // pushed simply have no remote-tracking ref and are skipped quietly.
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

async function doSetActiveChat(repo: string, branch: string | null): Promise<void> {
  if (!branch || !isCloned(repo)) return; // only act on opted-in repos
  const dir = repoDir(repo);
  const url = repoUrl(repo);
  emitStatus(repo, "syncing");
  try {
    const token = await getToken();
    await fetchAndReconcile(dir, url, token, branch, true);
    emitStatus(repo, "ready");
  } catch (error) {
    handleOpError(repo, branch, error);
  }
}

async function doSyncBranch(repo: string, branch: string): Promise<void> {
  if (!branch || !isCloned(repo)) return; // only act on opted-in repos
  const dir = repoDir(repo);
  const url = repoUrl(repo);
  emitStatus(repo, "syncing");
  try {
    const token = await getToken();
    // Update this branch's ref; materialize only if it's the checked-out branch.
    await fetchAndReconcile(dir, url, token, branch, false);
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

// -----------------------------------------------------------------------------
// Setup / IPC
// -----------------------------------------------------------------------------

export function setupGitSync(setupOptions: SetupOptions): void {
  opts = setupOptions;
  loadSettings();

  ipcMain.handle("git-sync:get-settings", () => settings);

  ipcMain.handle(
    "git-sync:set-settings",
    (_event, next: Partial<GitSyncSettings>) => {
      if (next.rootDirectory && typeof next.rootDirectory === "string") {
        settings.rootDirectory = next.rootDirectory;
      }
      persistSettings();
      return settings;
    }
  );

  ipcMain.handle("git-sync:pick-directory", async () => {
    const win = opts?.getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "Choose Backgrounder folder",
          defaultPath: settings.rootDirectory,
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
        });
    if (result.canceled || result.filePaths.length === 0) return null;
    settings.rootDirectory = result.filePaths[0];
    persistSettings();
    return settings.rootDirectory;
  });

  ipcMain.handle("git-sync:get-repo-state", (_event, repo: string) => {
    return { cloned: isCloned(repo) };
  });

  ipcMain.handle(
    "git-sync:open-repo-folder",
    async (
      _event,
      data: { repo: string; branches: string[]; activeBranch: string | null }
    ) => {
      try {
        await enqueue(data.repo, () =>
          doOpenRepoFolder(data.repo, data.branches ?? [], data.activeBranch ?? null)
        );
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        emitStatus(data.repo, "error", message);
        emitError(data.repo, data.activeBranch ?? undefined, message);
        return { success: false, error: message };
      }
    }
  );

  ipcMain.handle(
    "git-sync:set-active-chat",
    async (_event, data: { repo: string; branch: string | null }) => {
      if (!isCloned(data.repo)) return { success: true };
      await enqueue(data.repo, () => doSetActiveChat(data.repo, data.branch));
      return { success: true };
    }
  );

  ipcMain.handle(
    "git-sync:sync-branch",
    async (_event, data: { repo: string; branch: string }) => {
      if (!isCloned(data.repo)) return { success: true };
      await enqueue(data.repo, () => doSyncBranch(data.repo, data.branch));
      return { success: true };
    }
  );
}
