import { BrowserWindow, globalShortcut } from "electron";

// Default shortcuts
const DEFAULT_SHORTCUTS = {
  "toggle-window": "CmdOrCtrl+Shift+A",
  "new-chat": "CmdOrCtrl+Shift+N",
  search: "CmdOrCtrl+Shift+K",
};

let registeredShortcuts: string[] = [];
let mainWindowRef: BrowserWindow | null = null;

export function registerShortcuts(mainWindow: BrowserWindow) {
  mainWindowRef = mainWindow;

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
  mainWindowRef = null;
}

export function updateShortcut(
  action: keyof typeof DEFAULT_SHORTCUTS,
  newShortcut: string
): boolean {
  if (!mainWindowRef) return false;

  const oldShortcut = DEFAULT_SHORTCUTS[action];

  // Unregister old shortcut
  if (registeredShortcuts.includes(oldShortcut)) {
    globalShortcut.unregister(oldShortcut);
    registeredShortcuts = registeredShortcuts.filter((s) => s !== oldShortcut);
  }

  // Register new shortcut
  const handler = getShortcutHandler(action, mainWindowRef);
  const ret = globalShortcut.register(newShortcut, handler);

  if (ret) {
    registeredShortcuts.push(newShortcut);
    return true;
  }

  // If failed, re-register old shortcut
  globalShortcut.register(oldShortcut, handler);
  registeredShortcuts.push(oldShortcut);
  return false;
}

function getShortcutHandler(
  action: keyof typeof DEFAULT_SHORTCUTS,
  mainWindow: BrowserWindow
): () => void {
  switch (action) {
    case "toggle-window":
      return () => {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      };
    case "new-chat":
      return () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("shortcut", "new-chat");
      };
    case "search":
      return () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send("shortcut", "search");
      };
  }
}
