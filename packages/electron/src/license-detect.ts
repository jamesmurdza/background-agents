import { ipcMain, app } from "electron";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

/**
 * Result of auto-detecting Claude Code credentials
 */
export interface LicenseDetectResult {
  found: boolean;
  credentials: string | null;
  source: "keychain" | "file" | null;
  error?: string;
}

/**
 * Settings for license auto-detection
 */
interface LicenseDetectSettings {
  autoDetectEnabled: boolean;
}

// Default settings
let settings: LicenseDetectSettings = {
  autoDetectEnabled: true,
};

// Settings file path
const getSettingsPath = () =>
  path.join(app.getPath("userData"), "license-settings.json");

/**
 * Load settings from disk
 */
function loadSettings(): void {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, "utf-8");
      const loaded = JSON.parse(data);
      settings = { ...settings, ...loaded };
    }
  } catch (error) {
    console.error("Failed to load license detection settings:", error);
  }
}

/**
 * Save settings to disk
 */
function saveSettings(): void {
  try {
    const settingsPath = getSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to save license detection settings:", error);
  }
}

/**
 * Get Claude Code credentials file path based on OS
 * - Linux: ~/.claude/.credentials.json
 * - Windows: %USERPROFILE%\.claude\.credentials.json
 */
function getCredentialsFilePath(): string {
  const homeDir = app.getPath("home");
  return path.join(homeDir, ".claude", ".credentials.json");
}

/**
 * Read credentials from macOS Keychain
 */
function readFromKeychain(): LicenseDetectResult {
  try {
    // Execute security command to get credentials from Keychain
    const output = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"], // Suppress stderr
      }
    );

    const credentials = output.trim();
    if (credentials) {
      // Validate it's valid JSON
      try {
        JSON.parse(credentials);
        return {
          found: true,
          credentials,
          source: "keychain",
        };
      } catch {
        return {
          found: false,
          credentials: null,
          source: null,
          error: "Keychain contains invalid JSON",
        };
      }
    }

    return {
      found: false,
      credentials: null,
      source: null,
      error: "No credentials found in Keychain",
    };
  } catch (error) {
    // Command failed - credentials not found or access denied
    const message =
      error instanceof Error ? error.message : "Unknown keychain error";

    // Check if it's a "not found" error vs actual error
    if (message.includes("could not be found") || message.includes("SecKeychainSearchCopyNext")) {
      return {
        found: false,
        credentials: null,
        source: null,
        error: "Claude Code credentials not found in Keychain",
      };
    }

    return {
      found: false,
      credentials: null,
      source: null,
      error: `Keychain access error: ${message}`,
    };
  }
}

/**
 * Read credentials from file (Linux/Windows)
 */
function readFromFile(): LicenseDetectResult {
  try {
    const credentialsPath = getCredentialsFilePath();

    if (!fs.existsSync(credentialsPath)) {
      return {
        found: false,
        credentials: null,
        source: null,
        error: `Credentials file not found at ${credentialsPath}`,
      };
    }

    const content = fs.readFileSync(credentialsPath, "utf-8");

    // Validate it's valid JSON
    try {
      JSON.parse(content);
      return {
        found: true,
        credentials: content.trim(),
        source: "file",
      };
    } catch {
      return {
        found: false,
        credentials: null,
        source: null,
        error: "Credentials file contains invalid JSON",
      };
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown file read error";
    return {
      found: false,
      credentials: null,
      source: null,
      error: `Failed to read credentials file: ${message}`,
    };
  }
}

/**
 * Detect Claude Code credentials based on the current platform
 */
function detectClaudeCredentials(): LicenseDetectResult {
  if (!settings.autoDetectEnabled) {
    return {
      found: false,
      credentials: null,
      source: null,
      error: "Auto-detection is disabled",
    };
  }

  switch (process.platform) {
    case "darwin":
      // macOS - use Keychain
      return readFromKeychain();

    case "linux":
    case "win32":
      // Linux and Windows - use credentials file
      return readFromFile();

    default:
      return {
        found: false,
        credentials: null,
        source: null,
        error: `Unsupported platform: ${process.platform}`,
      };
  }
}

/**
 * Setup IPC handlers for license detection
 */
export function setupLicenseDetect(): void {
  // Load saved settings
  loadSettings();

  // Get auto-detected credentials
  ipcMain.handle("get-claude-license-auto-detect", () => {
    return detectClaudeCredentials();
  });

  // Get license detection settings
  ipcMain.handle("get-license-detect-settings", () => {
    return { autoDetectEnabled: settings.autoDetectEnabled };
  });

  // Update license detection settings
  ipcMain.handle(
    "set-license-detect-settings",
    (_event, newSettings: Partial<LicenseDetectSettings>) => {
      settings = { ...settings, ...newSettings };
      saveSettings();
      return true;
    }
  );
}

/**
 * Get current settings (for use in other modules if needed)
 */
export function getLicenseDetectSettings(): LicenseDetectSettings {
  return { ...settings };
}
