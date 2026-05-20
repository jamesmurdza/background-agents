import { ipcMain, Notification, app } from "electron";
import { simpleGit, SimpleGit } from "simple-git";
import path from "path";
import fs from "fs";

interface GitSyncSettings {
  enabled: boolean;
  syncDirectory: string;
  autoSync: boolean;
  bidirectionalSync: boolean;
}

let settings: GitSyncSettings = {
  enabled: false,
  syncDirectory: path.join(app.getPath("home"), "Projects"),
  autoSync: true,
  bidirectionalSync: false,
};

export function setupGitSync() {
  // Handle git push events from the renderer (via SSE)
  ipcMain.on(
    "git-pushed",
    async (
      _event,
      data: { repo: string; branch: string; commitSha: string }
    ) => {
      if (!settings.enabled || !settings.autoSync) {
        return;
      }

      try {
        await syncRepository(data.repo, data.branch);
      } catch (error) {
        console.error("Git sync failed:", error);
        showSyncNotification(
          "Sync Failed",
          `Failed to sync ${data.repo}: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error"
        );
      }
    }
  );

  // Get settings
  ipcMain.handle("get-git-sync-settings", () => {
    return settings;
  });

  // Update settings
  ipcMain.handle("set-git-sync-settings", (_event, newSettings: GitSyncSettings) => {
    settings = { ...settings, ...newSettings };
    // Ensure sync directory exists
    if (settings.enabled && !fs.existsSync(settings.syncDirectory)) {
      fs.mkdirSync(settings.syncDirectory, { recursive: true });
    }
    return true;
  });

  // Manual sync request
  ipcMain.handle(
    "sync-repository",
    async (_event, data: { repo: string; branch: string }) => {
      try {
        await syncRepository(data.repo, data.branch);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }
  );
}

async function syncRepository(repo: string, branch: string): Promise<void> {
  const repoName = repo.split("/")[1] || repo;
  const localPath = path.join(settings.syncDirectory, repoName);
  const repoUrl = `https://github.com/${repo}.git`;

  let git: SimpleGit;

  // Check if repo exists locally
  if (fs.existsSync(path.join(localPath, ".git"))) {
    // Existing repo - fetch and pull
    git = simpleGit(localPath);

    // Fetch all branches
    await git.fetch("origin");

    // Check if branch exists locally
    const branches = await git.branchLocal();
    const branchExists = branches.all.includes(branch);

    if (branchExists) {
      // Switch to branch and pull
      await git.checkout(branch);
      await git.pull("origin", branch);
    } else {
      // Create and track remote branch
      await git.checkoutBranch(branch, `origin/${branch}`);
    }

    showSyncNotification("Synced", `${repoName}:${branch} updated locally`, "success");
  } else {
    // New repo - clone
    fs.mkdirSync(localPath, { recursive: true });
    git = simpleGit(settings.syncDirectory);

    // Clone with specific branch
    await git.clone(repoUrl, repoName, ["--branch", branch]);

    showSyncNotification("Cloned", `${repoName}:${branch} cloned locally`, "success");
  }
}

function showSyncNotification(
  title: string,
  body: string,
  _type: "success" | "error"
) {
  const notification = new Notification({
    title: `Git Sync: ${title}`,
    body,
  });

  notification.show();
}

export function getSettings(): GitSyncSettings {
  return settings;
}

export function updateSettings(newSettings: Partial<GitSyncSettings>) {
  settings = { ...settings, ...newSettings };
}
