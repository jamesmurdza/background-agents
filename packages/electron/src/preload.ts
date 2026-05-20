import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electron", {
  // Platform info
  platform: process.platform,

  // Notifications
  showNotification: (options: { title: string; body: string; chatId?: string }) => {
    ipcRenderer.send("show-notification", options);
  },

  // Badge count
  updateBadge: (count: number) => {
    ipcRenderer.send("update-badge", count);
  },

  // Window control
  toggleWindow: () => {
    ipcRenderer.send("toggle-window");
  },

  // Auth token (secure storage)
  getAuthToken: () => ipcRenderer.invoke("get-auth-token"),
  setAuthToken: (token: string) => ipcRenderer.invoke("set-auth-token", token),

  // External links
  openExternal: (url: string) => {
    ipcRenderer.send("open-external", url);
  },

  // Git sync
  getGitSyncSettings: () => ipcRenderer.invoke("get-git-sync-settings"),
  setGitSyncSettings: (settings: {
    enabled: boolean;
    syncDirectory: string;
    autoSync: boolean;
    bidirectionalSync: boolean;
  }) => ipcRenderer.invoke("set-git-sync-settings", settings),

  // Event listeners
  onDeepLink: (callback: (data: { action: string; params: Record<string, string> }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { action: string; params: Record<string, string> }) => callback(data);
    ipcRenderer.on("deep-link", handler);
    return () => ipcRenderer.removeListener("deep-link", handler);
  },

  onNavigateToChat: (callback: (chatId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, chatId: string) => callback(chatId);
    ipcRenderer.on("navigate-to-chat", handler);
    return () => ipcRenderer.removeListener("navigate-to-chat", handler);
  },

  onGitPushed: (callback: (data: { repo: string; branch: string; commitSha: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { repo: string; branch: string; commitSha: string }) => callback(data);
    ipcRenderer.on("git-pushed", handler);
    return () => ipcRenderer.removeListener("git-pushed", handler);
  },

  onShortcut: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on("shortcut", handler);
    return () => ipcRenderer.removeListener("shortcut", handler);
  },
});

// Type declarations for the renderer
declare global {
  interface Window {
    electron: {
      platform: string;
      showNotification: (options: { title: string; body: string; chatId?: string }) => void;
      updateBadge: (count: number) => void;
      toggleWindow: () => void;
      getAuthToken: () => Promise<string | null>;
      setAuthToken: (token: string) => Promise<boolean>;
      openExternal: (url: string) => void;
      getGitSyncSettings: () => Promise<{
        enabled: boolean;
        syncDirectory: string;
        autoSync: boolean;
        bidirectionalSync: boolean;
      }>;
      setGitSyncSettings: (settings: {
        enabled: boolean;
        syncDirectory: string;
        autoSync: boolean;
        bidirectionalSync: boolean;
      }) => Promise<boolean>;
      onDeepLink: (callback: (data: { action: string; params: Record<string, string> }) => void) => () => void;
      onNavigateToChat: (callback: (chatId: string) => void) => () => void;
      onGitPushed: (callback: (data: { repo: string; branch: string; commitSha: string }) => void) => () => void;
      onShortcut: (callback: (action: string) => void) => () => void;
    };
  }
}
