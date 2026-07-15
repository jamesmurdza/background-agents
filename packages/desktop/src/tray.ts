import { app, BrowserWindow, Menu, nativeImage, Tray } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow) {
  // Create tray icon
  const iconPath = path.join(__dirname, "../assets/tray-icon.png");

  // Create a simple icon if the file doesn't exist
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      // Create a simple 16x16 icon as fallback
      icon = nativeImage.createEmpty();
    }
  } catch {
    icon = nativeImage.createEmpty();
  }

  // On macOS, use template image for proper appearance
  if (process.platform === "darwin") {
    icon.setTemplateImage(true);
  }

  tray = new Tray(icon);
  tray.setToolTip("Background Agents");

  // Build context menu
  const contextMenu = buildContextMenu(mainWindow, false);
  tray.setContextMenu(contextMenu);

  // Click behavior
  tray.on("click", () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Double-click to show (Windows)
  tray.on("double-click", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

function buildContextMenu(mainWindow: BrowserWindow, isHidden: boolean): Menu {
  return Menu.buildFromTemplate([
    {
      label: isHidden ? "Show Background Agents" : "Hide Background Agents",
      click: () => {
        if (isHidden) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          mainWindow.hide();
        }
      },
    },
    { type: "separator" },
    {
      label: "New Chat",
      accelerator: "CmdOrCtrl+N",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("shortcut", "new-chat");
      },
    },
    {
      label: "Search",
      accelerator: "CmdOrCtrl+K",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("shortcut", "search");
      },
    },
    { type: "separator" },
    {
      label: "Settings",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("shortcut", "settings");
      },
    },
    { type: "separator" },
    {
      label: "Quit Background Agents",
      accelerator: "CmdOrCtrl+Q",
      click: () => {
        app.quit();
      },
    },
  ]);
}

export function updateTrayMenu(mainWindow: BrowserWindow, isHidden: boolean) {
  if (tray) {
    const contextMenu = buildContextMenu(mainWindow, isHidden);
    tray.setContextMenu(contextMenu);
  }
}
