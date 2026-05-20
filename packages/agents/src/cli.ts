import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const BACKEND_URL = process.env.BACKGROUND_AGENTS_URL || "https://agents.new";
const APP_NAME = "background-agents";
const VERSION = "0.1.0";

// Platform-specific paths
function getAppDataDir(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", APP_NAME);
    case "win32":
      return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
    default:
      return path.join(os.homedir(), ".config", APP_NAME);
  }
}

function getElectronPath(): string {
  const appDataDir = getAppDataDir();
  switch (process.platform) {
    case "darwin":
      return path.join(appDataDir, "Background Agents.app", "Contents", "MacOS", "Background Agents");
    case "win32":
      return path.join(appDataDir, "Background Agents.exe");
    default:
      return path.join(appDataDir, "background-agents");
  }
}

function isElectronInstalled(): boolean {
  const electronPath = getElectronPath();
  return fs.existsSync(electronPath);
}

function printHelp() {
  console.log(`
Background Agents CLI v${VERSION}

Usage:
  background-agents [command] [options]

Commands:
  (default)   Launch the Background Agents desktop app
  open        Open the web app in your default browser
  help        Show this help message

Options:
  --url <url>   Override the backend URL (default: ${BACKEND_URL})
  --version     Show version number

Examples:
  background-agents              # Launch desktop app
  background-agents open         # Open in browser
  background-agents --url https://custom.domain.com
`);
}

async function launchElectronApp() {
  // For now, we'll use a development approach - run the electron package directly
  // In production, this would download and launch a prebuilt Electron app

  const electronPath = getElectronPath();

  if (isElectronInstalled()) {
    console.log("Launching Background Agents...");

    const child = spawn(electronPath, [], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        BACKGROUND_AGENTS_URL: BACKEND_URL,
      },
    });

    child.unref();
    console.log("Background Agents is running.");
    process.exit(0);
  } else {
    // Electron app not installed - provide instructions or open web
    console.log(`
Background Agents desktop app is not installed.

Options:
  1. Open the web app: background-agents open
  2. Install the desktop app from: https://github.com/jamesmurdza/upstream-agents/releases

For development:
  cd packages/electron && npm install && npm run dev
`);

    // Ask if they want to open the web app instead
    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question("Open web app in browser? (Y/n) ", async (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "n") {
        await openInBrowser();
      }
      process.exit(0);
    });
  }
}

async function openInBrowser() {
  console.log(`Opening ${BACKEND_URL} in your default browser...`);

  const openCommand = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open";

  try {
    execSync(`${openCommand} ${BACKEND_URL}`, { stdio: "ignore" });
  } catch (error) {
    console.log(`Please open ${BACKEND_URL} in your browser.`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let command = "";
  let customUrl = BACKEND_URL;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h" || arg === "help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--version" || arg === "-v") {
      console.log(`background-agents v${VERSION}`);
      process.exit(0);
    }

    if (arg === "--url" && args[i + 1]) {
      customUrl = args[i + 1];
      i++;
      continue;
    }

    if (!arg.startsWith("-")) {
      command = arg;
    }
  }

  // Update backend URL if custom one provided
  process.env.BACKGROUND_AGENTS_URL = customUrl;

  // Execute command
  switch (command) {
    case "open":
      await openInBrowser();
      break;
    case "":
    default:
      await launchElectronApp();
      break;
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
