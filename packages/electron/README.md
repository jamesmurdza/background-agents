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

### Standalone (from `packages/electron/`)

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
