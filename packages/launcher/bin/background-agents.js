#!/usr/bin/env node
"use strict";

// Background Agents desktop launcher.
//
// `npx background-agents` resolves the latest published version of this package,
// then this script spawns the bundled Electron app (packages/launcher/app),
// pointed at the production backend by default. The heavy Electron runtime is a
// normal npm dependency, so npm/npx downloads it (with its own progress bar) on
// first run and caches it for subsequent launches.

const path = require("path");
const fs = require("fs");
const https = require("https");
const { spawn } = require("child_process");

const { colors, symbols, Spinner, line, showCursor } = require("../lib/ui");
const pkg = require("../package.json");

const PROD_URL = "https://backgrounder.dev";
const DEV_URL = "http://localhost:4000";
const APP_ENTRY = path.join(__dirname, "..", "app", "dist", "main.js");
const READY_MARKER = "background-agents:ready";

function parseArgs(argv) {
  const opts = {
    url: null,
    dev: false,
    verbose: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") opts.help = true;
    else if (arg === "-v" || arg === "--version") opts.version = true;
    else if (arg === "--dev") opts.dev = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--url") opts.url = argv[++i];
    else if (arg.startsWith("--url=")) opts.url = arg.slice("--url=".length);
  }
  return opts;
}

function printBanner() {
  line();
  line(
    `  ${colors.bold(colors.magenta("Background Agents"))} ${colors.dim(
      "desktop launcher v" + pkg.version
    )}`
  );
  line(`  ${colors.dim("https://backgrounder.dev")}`);
  line();
}

function printHelp() {
  printBanner();
  line(`  ${colors.bold("Usage")}`);
  line(`    npx ${pkg.name} [options]`);
  line();
  line(`  ${colors.bold("Options")}`);
  line(`    --url <url>     Backend URL to load (default: ${PROD_URL})`);
  line(`    --dev          Use the local dev server (${DEV_URL})`);
  line(`    --verbose      Stream the desktop app's logs to this terminal`);
  line(`    -v, --version  Print the launcher version`);
  line(`    -h, --help     Show this help`);
  line();
  line(`  ${colors.bold("Environment")}`);
  line(`    BACKGROUND_AGENTS_URL   Same as --url (the --url flag wins)`);
  line();
  line(
    `  ${colors.dim(
      "Tip: run `npx " + pkg.name + "@latest` to always get the newest version."
    )}`
  );
  line();
}

// The `electron` package returns the absolute path to its binary when required
// from a normal Node process (i.e. not from inside Electron itself).
function resolveElectron() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch (_err) {
    return {
      error:
        "Electron runtime is not installed. Reinstall with: npx " +
        pkg.name +
        "@latest",
    };
  }
  if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
    return {
      error:
        "The Electron binary is missing or its download was skipped.\n" +
        "  Reinstall without ELECTRON_SKIP_BINARY_DOWNLOAD set, e.g.: npx background-agents@latest",
    };
  }
  return { electronPath };
}

// Non-blocking check of the npm registry for a newer launcher version.
function checkLatestVersion(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = https.get(
      `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/latest`,
      { headers: { accept: "application/json" }, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version || null);
          } catch (_err) {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function semverGt(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.version) {
    line(pkg.version);
    return;
  }

  printBanner();

  if (!fs.existsSync(APP_ENTRY)) {
    line(
      `  ${symbols.error} ${colors.red(
        "App bundle is missing — this package was built incorrectly."
      )}`
    );
    line(`  ${colors.dim("Expected: " + APP_ENTRY)}`);
    process.exitCode = 1;
    return;
  }

  const { electronPath, error } = resolveElectron();
  if (error) {
    line(`  ${symbols.error} ${colors.red(error)}`);
    process.exitCode = 1;
    return;
  }

  const backendUrl =
    opts.url ||
    (opts.dev ? DEV_URL : process.env.BACKGROUND_AGENTS_URL || PROD_URL);

  const latestPromise = checkLatestVersion();

  const spinner = new Spinner();
  spinner.start(`Launching Background Agents ${colors.dim("→ " + backendUrl)}`);

  const env = Object.assign({}, process.env, {
    BACKGROUND_AGENTS_URL: backendUrl,
    // Avoid Electron attaching to / spawning a console window on Windows.
    ELECTRON_NO_ATTACH_CONSOLE: "1",
  });

  const child = spawn(electronPath, [APP_ENTRY], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  let ready = false;
  let exited = false;

  function announceRunning() {
    if (ready) return;
    ready = true;
    clearTimeout(readyFallback);
    spinner.succeed(
      `Background Agents is running ${colors.dim("→ " + backendUrl)}`
    );
    line(
      `  ${colors.dim("Close the app window (or press Ctrl+C here) to quit.")}`
    );
    latestPromise.then((latest) => {
      if (!exited && latest && semverGt(latest, pkg.version)) {
        line();
        line(
          `  ${symbols.info} ${colors.yellow(
            "A newer version is available"
          )} ${colors.dim("(" + pkg.version + " → " + latest + ")")}`
        );
        line(
          `  ${colors.dim("Update with: ")}${colors.cyan(
            "npx " + pkg.name + "@latest"
          )}`
        );
      }
    });
  }

  function handleOutput(buffer, stream) {
    const text = buffer.toString();
    if (text.includes(READY_MARKER)) announceRunning();
    if (opts.verbose) {
      const cleaned = text.split(READY_MARKER).join("").replace(/\n{2,}/g, "\n");
      if (cleaned.trim()) stream.write(colors.dim(cleaned));
    }
  }

  child.stdout.on("data", (b) => handleOutput(b, process.stdout));
  child.stderr.on("data", (b) => handleOutput(b, process.stderr));

  // Fallback: if the app never prints the ready marker (older build, or output
  // buffered), assume it's up after a short grace period so the UI doesn't hang.
  const readyFallback = setTimeout(announceRunning, 8000);
  if (readyFallback.unref) readyFallback.unref();

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(readyFallback);
    try {
      child.kill(signal || "SIGTERM");
    } catch (_err) {
      /* ignore */
    }
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  child.on("error", (err) => {
    exited = true;
    clearTimeout(readyFallback);
    if (!ready) spinner.fail("Failed to launch Background Agents");
    showCursor();
    line(`  ${symbols.error} ${colors.red(err.message)}`);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    exited = true;
    clearTimeout(readyFallback);
    showCursor();
    if (!ready) {
      spinner.fail("Background Agents exited before it finished starting");
      if (code) {
        line(
          `  ${colors.dim(
            "The app exited with code " +
              code +
              ". Re-run with --verbose to see its logs."
          )}`
        );
      }
    } else {
      line(`  ${symbols.arrow} ${colors.dim("Background Agents closed.")}`);
    }
    process.exitCode = signal ? 0 : code == null ? 0 : code;
  });
}

try {
  main();
} catch (err) {
  showCursor();
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
}
