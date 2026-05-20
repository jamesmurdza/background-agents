import { BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";

export function setupAutoUpdater(mainWindow: BrowserWindow) {
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Check for updates on startup (with delay)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log("Auto-update check failed:", err.message);
    });
  }, 10000); // Wait 10 seconds after startup

  // Check for updates periodically (every hour)
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.log("Auto-update check failed:", err.message);
      });
    },
    60 * 60 * 1000
  );

  // Update available
  autoUpdater.on("update-available", (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Available",
        message: `A new version (${info.version}) is available. Would you like to download it now?`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  // Update not available
  autoUpdater.on("update-not-available", () => {
    console.log("No updates available");
  });

  // Download progress
  autoUpdater.on("download-progress", (progress) => {
    mainWindow.webContents.send("update-progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  // Update downloaded
  autoUpdater.on("update-downloaded", (info) => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: `Version ${info.version} has been downloaded. Restart now to install?`,
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall(false, true);
        }
      });
  });

  // Error handling
  autoUpdater.on("error", (err) => {
    console.error("Auto-updater error:", err);
  });
}

export function checkForUpdates() {
  return autoUpdater.checkForUpdates();
}

export function downloadUpdate() {
  return autoUpdater.downloadUpdate();
}

export function installUpdate() {
  autoUpdater.quitAndInstall(false, true);
}
