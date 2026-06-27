# Background Agents — Electron desktop app

A thin Electron wrapper that loads the [`web`](../web) app in a desktop window. Adds OS-native features the browser can't provide:

- System tray + global shortcuts
- Native notifications
- macOS dock badge
- Deep links (`background-agents://...`) for OAuth redirect
- Auto-update via `electron-updater`
- Git-sync helpers and license-detection IPC

The actual chat UI, sandbox management, and agent integration all live in the [`web`](../web) package — this package only wraps it.

## How it picks a backend URL

`main.ts` derives the backend URL at startup:

- **Packaged build** (`app.isPackaged === true`) → `https://backgrounder.dev`
- **Dev** (running from source) → `http://localhost:4000`

Either is overridden if `BACKGROUND_AGENTS_URL` is set.

## Usage

### Dev (web + electron together)

From the repo root, this starts the local web dev server and launches the desktop app pointing at it:

```bash
npm run dev:electron
```

### Standalone against production

From the repo root, this launches the desktop app pointing at the production
backend (`https://backgrounder.dev`):

```bash
npm run start:electron
```

Override the target with `BACKGROUND_AGENTS_URL` if needed.

### Standalone (from `packages/desktop/`)

Requires a backend already running at `http://localhost:4000` (or override `BACKGROUND_AGENTS_URL`):

```bash
npm run build && npm run start
```

## Packaging

Cross-platform installers via `electron-builder` (config in `package.json` under `"build"`):

| Command | Output |
|---------|--------|
| `npm run package:mac` | `.dmg` + `.zip` |
| `npm run package:win` | NSIS installer + portable `.exe` |
| `npm run package:linux` | `.AppImage` + `.deb` |
| `npm run package` | Builds for the current platform |

Output goes to `release/`.

## Automated releases (GitHub Actions)

The workflow at `.github/release-workflow.yml` builds for macOS, Windows,
and Linux and publishes the installers to a GitHub Release. (It lives outside
`.github/workflows/` because pushing there needs the GitHub `workflow` OAuth
scope — move it into `.github/workflows/` once your token has that scope, or
add it via the GitHub web UI.)

Trigger a release by pushing a version tag:

```bash
# bump "version" in packages/desktop/package.json first
git tag v0.1.1 && git push origin v0.1.1
```

electron-builder uploads to a **draft** release. Review it, then click
**Publish** — auto-update only sees published (non-draft) releases.

## Auto-update

`electron-updater` (wired up in `src/autoupdate.ts`, active only in packaged
builds) checks the GitHub Releases of the repo named in the `publish` config.
For an update to be delivered:

1. The release must be **published** (not draft/prerelease).
2. The `version` must be higher than the installed one.
3. The platform's update target must be present: NSIS `.exe` (Windows),
   `.zip` (macOS — not the `.dmg`), or `.AppImage` (Linux). `portable`/`.deb`
   do **not** auto-update.

### macOS code signing + notarization

macOS auto-update **requires** a signed + notarized build (Apple Developer
account, $99/yr). The build config (`mac.hardenedRuntime`, entitlements,
`notarize`) and the workflow are already set up; they stay inert and produce an
unsigned build until you add these repo secrets
(**Settings → Secrets and variables → Actions**):

| Secret | Value |
|--------|-------|
| `MAC_CSC_LINK` | base64 of your **Developer ID Application** `.p12` (`base64 -i cert.p12`) |
| `MAC_CSC_KEY_PASSWORD` | password used when exporting the `.p12` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char Team ID from developer.apple.com |

Windows and Linux auto-update with no signing required.
