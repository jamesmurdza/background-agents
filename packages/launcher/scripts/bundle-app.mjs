// Builds the Electron app (@background-agents/desktop) and copies its compiled
// output + assets into this package's `app/` directory, so the published
// `background-agents` npm package is fully self-contained.
//
// Runs automatically on `npm pack` / `npm publish` via the "prepack" script,
// and can be run manually with `npm run bundle`.

import { execSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const launcherDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(launcherDir, "..", "..");
const electronDir = path.join(repoRoot, "packages", "electron");
const appDir = path.join(launcherDir, "app");

function log(message) {
  process.stdout.write(`[bundle] ${message}\n`);
}

const distDir = path.join(electronDir, "dist");
const assetsDir = path.join(electronDir, "assets");
const mainJs = path.join(distDir, "main.js");
const preloadCjs = path.join(distDir, "preload.cjs");

log("Building @background-agents/desktop…");
execSync("npm run build -w @background-agents/desktop", {
  cwd: repoRoot,
  stdio: "inherit",
});

if (!existsSync(mainJs)) {
  throw new Error(`Expected build output not found: ${mainJs}`);
}
if (!existsSync(preloadCjs)) {
  throw new Error(`Expected preload output not found: ${preloadCjs}`);
}
if (!existsSync(assetsDir)) {
  throw new Error(`Expected assets directory not found: ${assetsDir}`);
}

log("Copying app bundle into launcher/app …");
rmSync(appDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });
// Preserve the same relative layout the app expects at runtime:
//   app/dist/main.js   →  loads ./preload.cjs  and  ../assets/icon.png
cpSync(distDir, path.join(appDir, "dist"), { recursive: true });
cpSync(assetsDir, path.join(appDir, "assets"), { recursive: true });

// CRITICAL: main.js is built as ESM (tsup --format esm), but the launcher
// package is "type": "commonjs". Without this, Electron loads main.js as
// CommonJS and throws "Cannot use import statement outside a module".
// Mirror packages/desktop (which is "type": "module") by giving the bundled
// app its own ESM scope. preload.cjs stays CommonJS via its .cjs extension.
writeFileSync(
  path.join(appDir, "package.json"),
  JSON.stringify(
    { name: "background-agents-app", version: "0.0.0", private: true, type: "module" },
    null,
    2
  ) + "\n"
);

// tsup leaves the Electron app's `dependencies` unbundled, so main.js imports
// them at runtime (e.g. isomorphic-git, electron-updater). The launcher must
// declare those same deps or the published package crashes with
// ERR_MODULE_NOT_FOUND. Verify that here so a new Electron dep can't silently
// break the launcher.
const electronDeps = JSON.parse(
  readFileSync(path.join(electronDir, "package.json"), "utf8")
).dependencies || {};
const launcherPkgPath = path.join(launcherDir, "package.json");
const launcherDeps = JSON.parse(readFileSync(launcherPkgPath, "utf8")).dependencies || {};
const missing = Object.keys(electronDeps).filter((d) => !(d in launcherDeps));
if (missing.length > 0) {
  throw new Error(
    `launcher/package.json is missing runtime deps required by the bundled app: ` +
      `${missing.join(", ")}. Add them to packages/launcher/package.json "dependencies" ` +
      `(match the versions in packages/desktop/package.json).`
  );
}

log(`Done. Bundled into ${path.relative(repoRoot, appDir)}`);
