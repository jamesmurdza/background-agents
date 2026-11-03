import { ipcMain, dialog } from "electron";
import { loadSettings, persistSettings, settings, type GitSyncSettings } from "./git-sync-settings.js";
import { enqueue } from "./git-sync-queue.js";
import { isCloned } from "./git-sync-git-ops.js";
import { configure, emitError, emitStatus, getWindow, type SetupOptions } from "./git-sync-runtime.js";
import { doOpenRepoFolder, doSetActiveChat, doSyncBranch } from "./git-sync-operations.js";

// =============================================================================
// Local repo sync (Backgrounder folder) — pure-Electron, one-way (cloud → local)
//
// All git operations run through isomorphic-git (no system `git` binary). The
// renderer orchestrates (it knows the chats / repos / branches); this module is
// the git executor. Only repos the user has explicitly opened (cloned under the
// root folder) are auto-synced — every handler no-ops for a repo that isn't
// cloned yet.
//
// The implementation is split across a few focused files:
//   - git-sync-settings.ts:   persisted root-directory setting
//   - git-sync-queue.ts:      per-repo serial operation queue
//   - git-sync-git-ops.ts:    isomorphic-git plumbing (clone/fetch/checkout)
//   - git-sync-runtime.ts:    renderer notifications + GitHub token minting
//   - git-sync-operations.ts: the open/set-active-chat/sync-branch flows
// This file just wires the IPC handlers to those pieces.
// =============================================================================

export type { SetupOptions };

export function setupGitSync(setupOptions: SetupOptions): void {
  configure(setupOptions);
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
    const win = getWindow();
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
