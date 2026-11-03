import { Notification, type BrowserWindow } from "electron";

// =============================================================================
// Shared runtime context (the active window + backend URL) and the renderer
// notifications / token minting that depend on it.
// =============================================================================

export type RepoSyncState = "idle" | "cloning" | "syncing" | "ready" | "error";

export interface SetupOptions {
  /** Returns the current main window (used for events, dialogs, and the auth session). */
  getWindow: () => BrowserWindow | null;
  /** Base URL of the web backend (used to mint the GitHub token). */
  backendUrl: string;
}

let opts: SetupOptions | null = null;

export function configure(setupOptions: SetupOptions): void {
  opts = setupOptions;
}

export function getWindow(): BrowserWindow | null {
  return opts?.getWindow() ?? null;
}

export function emitStatus(repo: string, status: RepoSyncState, message?: string): void {
  opts?.getWindow()?.webContents.send("sync-status", { repo, status, message });
}

export function emitError(repo: string, branch: string | undefined, message: string): void {
  opts?.getWindow()?.webContents.send("sync-error", { repo, branch, message });
  new Notification({ title: "Local sync error", body: message }).show();
}

/** Mint a short-lived GitHub token from the backend, scoped to the auth session. */
export async function getToken(): Promise<string> {
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
