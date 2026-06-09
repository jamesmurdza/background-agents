# background-agents

Launch the **Background Agents** desktop app with a single command — no install, always the latest version:

```bash
npx background-agents@latest
```

That's it. The first run downloads the Electron runtime (~once, then cached); every run loads the production app at <https://backgrounder.dev>.

> **Naming:** the TypeScript SDK previously published as `background-agents` now lives at [`@background-agents/sdk`](../agents), which freed the `background-agents` name for this desktop launcher.

## How it works

This is a thin launcher published to npm as [`background-agents`](https://www.npmjs.com/package/background-agents):

1. `npx background-agents@latest` resolves the **latest published version** of this package from the npm registry.
2. npm installs it and its one dependency, **Electron**, downloading the platform binary on first run (cached for later runs).
3. The launcher spawns the bundled Electron app (`app/`) pointed at the production backend, showing a small terminal UI while it starts.

Because every launch pulls the latest npm version, **publishing a new version is the update mechanism** — there's no separate auto-updater to configure or code-sign.

## Usage

```bash
npx background-agents [options]
```

| Option | Description |
|--------|-------------|
| `--url <url>` | Backend URL to load (default: `https://backgrounder.dev`) |
| `--dev` | Use the local dev server (`http://localhost:4000`) |
| `--verbose` | Stream the desktop app's logs to the terminal |
| `-v`, `--version` | Print the launcher version |
| `-h`, `--help` | Show help |

Environment variable `BACKGROUND_AGENTS_URL` does the same as `--url` (the flag wins).

> Tip: plain `npx background-agents` may reuse an npx-cached copy. Use `npx background-agents@latest` to force the newest version.

## Caveats

- **First run downloads Electron** (~100–150 MB) via npm; it's cached afterward and re-downloaded only when a new version ships a different Electron.
- The app runs **unpackaged**, so it relies on programmatic `background-agents://` deep-link registration for the OAuth round-trip (same code path as running the app from source). For a fully signed/notarized native install, use the packaged builds from GitHub Releases instead.
- This package was **0.1.1 / 0.1.2 as the SDK**; the launcher is published from **1.0.0** onward, so `latest` cleanly points at the desktop app.

## Development

This package lives in the monorepo at `packages/launcher`. Its `app/` directory is generated — it's a copy of the compiled `@background-agents/electron` output.

```bash
# From the repo root:
npm run bundle -w background-agents   # build the Electron app + copy it into app/
npm start -w background-agents        # run the launcher locally (after bundling)

# Verify the published tarball contents:
cd packages/launcher && npm pack --dry-run
```

`prepack` runs the bundle step automatically, so `npm publish` always ships a fresh build.

## Publishing

Two ways:

### Automatic — on a version tag (GitHub Actions)

Pushing a `v*` tag runs the publish workflow, which sets the package version from the tag and publishes to npm (requires the `NPM_TOKEN` repo secret).

```bash
git tag v1.0.1 && git push origin v1.0.1
```

> The workflow lives at `.github/workflows/npm-publish.yml` and is active. Note the same `v*` tag also triggers the Electron installer build in `.github/release-workflow.yml` (still outside `.github/workflows/` — see the [electron package](../electron/README.md#automated-releases-github-actions) for how to activate it), so the desktop installers and the npm launcher publish together once both workflows are active.

### Manual

```bash
npm ci                                   # from the repo root
npm publish -w background-agents --access public
```

You must be logged in (`npm login`) with publish rights to the `background-agents` package. The first launcher publish must be version **≥ 1.0.0** (0.1.1 / 0.1.2 already exist from the SDK era).
