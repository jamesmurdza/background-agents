import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Notification,
  shell,
  nativeTheme,
} from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { createTray, updateTrayMenu } from "./tray.js";
import { registerShortcuts, unregisterShortcuts } from "./shortcuts.js";
import { setupDeepLinks } from "./deeplinks.js";
import { setupGitSync } from "./git-sync.js";
import { setupAutoUpdater } from "./autoupdate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Backend URL - configurable via environment
const BACKEND_URL =
  process.env.BACKGROUND_AGENTS_URL || "https://agents.new";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Background Agents",
    icon: path.join(__dirname, "../assets/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    show: false,
  });

  // Load the hosted backend
  mainWindow.loadURL(BACKEND_URL);

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Minimize to tray instead of closing
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  // Handle window state changes for tray updates
  mainWindow.on("show", () => {
    updateTrayMenu(mainWindow!, false);
  });

  mainWindow.on("hide", () => {
    updateTrayMenu(mainWindow!, true);
  });

  return mainWindow;
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    // Someone tried to run a second instance, focus our window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }

    // Handle deep link from second instance (Windows)
    const deepLink = commandLine.find((arg) =>
      arg.startsWith("background-agents://")
    );
    if (deepLink) {
      handleDeepLink(deepLink);
    }
  });
}

// Handle deep link
function handleDeepLink(url: string) {
  if (!mainWindow) return;

  try {
    const parsed = new URL(url);
    const action = parsed.hostname;
    const params = Object.fromEntries(parsed.searchParams);

    mainWindow.webContents.send("deep-link", { action, params });
    mainWindow.show();
    mainWindow.focus();
  } catch (error) {
    console.error("Failed to parse deep link:", error);
  }
}

// App ready
app.whenReady().then(async () => {
  // Set app user model ID for Windows notifications
  if (process.platform === "win32") {
    app.setAppUserModelId("com.background-agents.desktop");
  }

  // Create main window
  const window = createWindow();

  // Setup features
  createTray(window);
  registerShortcuts(window);
  setupDeepLinks(handleDeepLink);
  setupGitSync();
  setupAutoUpdater(window);

  // macOS: recreate window if dock icon clicked
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// Handle quit
app.on("before-quit", () => {
  isQuitting = true;
});

app.on("will-quit", () => {
  unregisterShortcuts();
});

// macOS: handle deep link when app is already running
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// IPC Handlers

// Show native notification
ipcMain.on(
  "show-notification",
  (_event, { title, body, chatId }: { title: string; body: string; chatId?: string }) => {
    const notification = new Notification({
      title,
      body,
      icon: path.join(__dirname, "../assets/icon.png"),
    });

    notification.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
      if (chatId) {
        mainWindow?.webContents.send("navigate-to-chat", chatId);
      }
    });

    notification.show();
  }
);

// Update badge count (macOS dock, Windows taskbar)
ipcMain.on("update-badge", (_event, count: number) => {
  if (process.platform === "darwin") {
    app.dock?.setBadge(count > 0 ? count.toString() : "");
  }
  // Windows overlay would require a custom overlay icon
});

// Toggle window visibility
ipcMain.on("toggle-window", () => {
  if (mainWindow?.isVisible() && mainWindow?.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow?.show();
    mainWindow?.focus();
  }
});

// Get auth token from secure storage
ipcMain.handle("get-auth-token", async () => {
  // For now, return null - auth is handled by the web app's cookies
  // In future, implement safeStorage for Bearer token auth
  return null;
});

// Set auth token to secure storage
ipcMain.handle("set-auth-token", async (_event, _token: string) => {
  // For now, no-op - auth is handled by the web app's cookies
  // In future, implement safeStorage for Bearer token auth
  return true;
});

// Open external URL
ipcMain.on("open-external", (_event, url: string) => {
  shell.openExternal(url);
});

// Git sync settings
ipcMain.handle("get-git-sync-settings", async () => {
  // Return default settings - can be enhanced with electron-store
  return {
    enabled: false,
    syncDirectory: path.join(app.getPath("home"), "Projects"),
    autoSync: true,
    bidirectionalSync: false,
  };
});

ipcMain.handle("set-git-sync-settings", async (_event, _settings: unknown) => {
  // Save settings - can be enhanced with electron-store
  return true;
});
