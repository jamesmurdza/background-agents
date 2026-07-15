import { BrowserWindow, globalShortcut } from "electron";

// Default shortcuts
const DEFAULT_SHORTCUTS = {
  "toggle-window": "CmdOrCtrl+Shift+A",
  "new-chat": "CmdOrCtrl+Shift+N",
  search: "CmdOrCtrl+Shift+K",
};

let registeredShortcuts: string[] = [];

export function registerShortcuts(mainWindow: BrowserWindow) {
  // Toggle window (global, works even when app not focused)
  const toggleRet = globalShortcut.register(
    DEFAULT_SHORTCUTS["toggle-window"],
    () => {
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  );

  if (toggleRet) {
    registeredShortcuts.push(DEFAULT_SHORTCUTS["toggle-window"]);
    console.log(
      `Registered global shortcut: ${DEFAULT_SHORTCUTS["toggle-window"]} (toggle window)`
    );
  } else {
    console.warn(
      `Failed to register shortcut: ${DEFAULT_SHORTCUTS["toggle-window"]}`
    );
  }

  // New chat (global)
  const newChatRet = globalShortcut.register(
    DEFAULT_SHORTCUTS["new-chat"],
    () => {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("shortcut", "new-chat");
    }
  );

  if (newChatRet) {
    registeredShortcuts.push(DEFAULT_SHORTCUTS["new-chat"]);
    console.log(
      `Registered global shortcut: ${DEFAULT_SHORTCUTS["new-chat"]} (new chat)`
    );
  } else {
    console.warn(
      `Failed to register shortcut: ${DEFAULT_SHORTCUTS["new-chat"]}`
    );
  }

  // Search (global)
  const searchRet = globalShortcut.register(DEFAULT_SHORTCUTS["search"], () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("shortcut", "search");
  });

  if (searchRet) {
    registeredShortcuts.push(DEFAULT_SHORTCUTS["search"]);
    console.log(
      `Registered global shortcut: ${DEFAULT_SHORTCUTS["search"]} (search)`
    );
  } else {
    console.warn(`Failed to register shortcut: ${DEFAULT_SHORTCUTS["search"]}`);
  }
}

export function unregisterShortcuts() {
  for (const shortcut of registeredShortcuts) {
    globalShortcut.unregister(shortcut);
  }
  registeredShortcuts = [];
}
