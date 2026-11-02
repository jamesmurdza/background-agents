import { app } from "electron";
import path from "path";
import fs from "fs";

// =============================================================================
// Persisted git-sync settings (which local folder holds the synced repos).
// =============================================================================

export interface GitSyncSettings {
  /** Root folder that holds all locally-synced Backgrounder repos. */
  rootDirectory: string;
}

const SETTINGS_FILE = "git-sync-settings.json";

function defaultRootDirectory(): string {
  // app.getPath("home") resolves to ~ on macOS/Linux and %USERPROFILE% on Windows.
  return path.join(app.getPath("home"), "Backgrounder");
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

export const settings: GitSyncSettings = { rootDirectory: defaultRootDirectory() };

export function loadSettings(): void {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<GitSyncSettings>;
    if (parsed.rootDirectory && typeof parsed.rootDirectory === "string") {
      settings.rootDirectory = parsed.rootDirectory;
    }
  } catch {
    // No persisted settings yet — keep the OS default.
  }
}

export function persistSettings(): void {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
  } catch (error) {
    console.error("[git-sync] Failed to persist settings:", error);
  }
}
