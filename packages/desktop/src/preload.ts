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

  // Local repo sync (Backgrounder folder)
  getGitSyncSettings: () => ipcRenderer.invoke("git-sync:get-settings"),
  setGitSyncSettings: (settings: { rootDirectory: string }) =>
    ipcRenderer.invoke("git-sync:set-settings", settings),
  pickSyncDirectory: () => ipcRenderer.invoke("git-sync:pick-directory"),
  getRepoSyncState: (repo: string) =>
    ipcRenderer.invoke("git-sync:get-repo-state", repo),
  openRepoFolder: (data: {
    repo: string;
    branches: string[];
    activeBranch: string | null;
  }) => ipcRenderer.invoke("git-sync:open-repo-folder", data),
  setActiveChat: (data: { repo: string; branch: string | null }) =>
    ipcRenderer.invoke("git-sync:set-active-chat", data),
  syncBranch: (data: { repo: string; branch: string }) =>
    ipcRenderer.invoke("git-sync:sync-branch", data),

  // License auto-detection
  getClaudeLicenseAutoDetect: () =>
    ipcRenderer.invoke("get-claude-license-auto-detect"),
  getLicenseDetectSettings: () =>
    ipcRenderer.invoke("get-license-detect-settings"),
  setLicenseDetectSettings: (settings: { autoDetectEnabled: boolean }) =>
    ipcRenderer.invoke("set-license-detect-settings", settings),

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

  onSyncStatus: (
    callback: (data: { repo: string; status: string; message?: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { repo: string; status: string; message?: string }
    ) => callback(data);
    ipcRenderer.on("sync-status", handler);
    return () => ipcRenderer.removeListener("sync-status", handler);
  },

  onSyncError: (
    callback: (data: { repo: string; branch?: string; message: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { repo: string; branch?: string; message: string }
    ) => callback(data);
    ipcRenderer.on("sync-error", handler);
    return () => ipcRenderer.removeListener("sync-error", handler);
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
      getGitSyncSettings: () => Promise<{ rootDirectory: string }>;
      setGitSyncSettings: (settings: { rootDirectory: string }) => Promise<{
        rootDirectory: string;
      }>;
      pickSyncDirectory: () => Promise<string | null>;
      getRepoSyncState: (repo: string) => Promise<{ cloned: boolean }>;
      openRepoFolder: (data: {
        repo: string;
        branches: string[];
        activeBranch: string | null;
      }) => Promise<{ success: boolean; error?: string }>;
      setActiveChat: (data: {
        repo: string;
        branch: string | null;
      }) => Promise<{ success: boolean }>;
      syncBranch: (data: {
        repo: string;
        branch: string;
      }) => Promise<{ success: boolean }>;
      getClaudeLicenseAutoDetect: () => Promise<{
        found: boolean;
        credentials: string | null;
        source: "keychain" | "file" | null;
        error?: string;
      }>;
      getLicenseDetectSettings: () => Promise<{ autoDetectEnabled: boolean }>;
      setLicenseDetectSettings: (settings: {
        autoDetectEnabled: boolean;
      }) => Promise<boolean>;
      onDeepLink: (callback: (data: { action: string; params: Record<string, string> }) => void) => () => void;
      onNavigateToChat: (callback: (chatId: string) => void) => () => void;
      onGitPushed: (callback: (data: { repo: string; branch: string; commitSha: string }) => void) => () => void;
      onShortcut: (callback: (action: string) => void) => () => void;
      onSyncStatus: (
        callback: (data: { repo: string; status: string; message?: string }) => void
      ) => () => void;
      onSyncError: (
        callback: (data: { repo: string; branch?: string; message: string }) => void
      ) => () => void;
    };
  }
}
