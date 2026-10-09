# Background Agents — Docs

The docs site behind **docs.backgrounder.dev**. Plain Markdown content + a single-file viewer.
No framework, no dependencies — the only build step writes one small config file.

## View it locally

From the repo root:

```
npm run dev:docs      # -> http://localhost:4001
```

(Open it through the server, not as a `file://` — the viewer fetches the Markdown over HTTP.)

## Structure

```
docs/
  public/index.html     The whole viewer: sidebar, router, Markdown renderer, :::media directive.
  public/content/*.md   One Markdown file per page. Source of truth. Portable to any docs platform.
  public/media/         Committed screenshots (PNG) + 3 placeholder SVGs. Videos/GIFs live on R2 (see below).
  scripts/              media-config generator (build step) + the local static server.
  vercel.json           Static deploy: build writes media-config.js, `public/` is the output.
  README.md             This file.
```

To add or reorder pages, edit the `NAV` array near the top of the `<script>` in `public/index.html`.

## Deployment

Deployed to Vercel as its own project, separate from `packages/web`:

- **Root Directory**: `packages/docs`
- **Domain**: `docs.backgrounder.dev`
- **Env**: `DOCS_MEDIA_BASE` (see below)

The web app links to it from the sidebar via `NEXT_PUBLIC_DOCS_URL`, which defaults to
`https://docs.backgrounder.dev`. Point that at `http://localhost:4001` to test against a local
docs server.

### Where media is served from

Screenshots (PNG) and the placeholder SVGs are committed under `public/media/` and served
locally. Big media — videos (`.mp4`) and GIFs (`.gif`) — is **not** committed (see
`public/media/.gitignore`); it's hosted on a Cloudflare R2 public bucket to keep the git repo
lightweight. `index.html` resolves those from `window.DOCS_MEDIA_BASE` (`R2_BASE`), which is
generated into `public/media-config.js` from the `DOCS_MEDIA_BASE` env var at build time. Videos
load from `${R2_BASE}/videos/<file>` and GIFs from `${R2_BASE}/gifs/<file>`. If the base is empty
or absent, the viewer falls back to serving everything locally from `media/`.

Locally, set it in `packages/docs/.env.local` (gitignored):

```
DOCS_MEDIA_BASE=https://pub-<hash>.r2.dev
```

## The `:::media` directive

Media slots use a small directive instead of raw `<img>`/`<video>`:

```
:::media type="gif" file="Smithry-Mcp-connect.gif" duration="~12s"
Caption describing what the clip shows.
:::
```

- `type` is `video`, `gif`, or `image`.
- Until the real file resolves, a labeled **placeholder** renders automatically.
- **Add the real file with the exact `file` name and it appears — no Markdown edits.** Screenshots
  (PNG) go into `media/`; videos (`.mp4`) and GIFs (`.gif`) go into the R2 bucket (under `videos/`
  and `gifs/`) — see [Where media is served from](#where-media-is-served-from).
  (Images/GIFs fall back to the placeholder via `onerror`; videos with a `file` show their first
  frame, and only use the placeholder as their poster when no `file` is given.)

## Media status

Screenshots below are committed under `media/`; videos and GIFs are hosted on R2 (see above).

### Videos (narrated MP4, on R2)

| File | Page | Shows |
|------|------|-------|
| `overview.mp4` | Overview | Product tour: create chat → pick agent → sandbox works → open PR |
| `coding-automation.mp4` | Issue → pull request | New GitHub issue fires the agent → it implements → opens a PR |
| `repo-less.mp4` | Daily email digest | Repo-less scheduled agent reads email → writes a digest to Notion |
| `gravity-game.mp4` | Build a mini-game | Prompt → agent builds a physics sandbox → playable in preview |
| `multi-agent-final.mp4` | Agent Battle | One "build Snake" prompt across Claude Code, Kimi Code, OpenCode |

### GIFs (silent, looping, on R2)

| File | Page | Shows |
|------|------|-------|
| `share-link.gif` | Overview | Create a share link → open the read-only public view |
| `connect-repo.gif` | Connect a repository | Connect a repo → new working branch |
| `Smithry-Mcp-connect.gif` | MCP servers | Search Smithery → connect → OAuth → tool available |
| `github-mcp-connect.gif` | GitHub MCP | Connect the GitHub MCP server → agent uses an issue/PR tool |
| `skill-install.gif` | Skills | Search skills.sh → install → skill available |
| `add-custom-endpoint.gif` | Custom endpoints | Add endpoint → fill fields → appears in model dropdown |

### Screenshots (PNG, committed under `media/`)

| File | Page(s) |
|------|---------|
| `chat-overview.png` | Overview |
| `jobs-list.png` | Jobs |
| `scheduled-job-form.png` | Jobs |
| `webhook-url-panel.png` | Jobs, Issue → pull request |
| `schedule-daily-9am.png` | Daily email digest |
| `run-detail.png` | Jobs, Issue → pull request |
| `run-detail-email.png` | Daily email digest |
| `branch-agents.png` | Agent Battle |
| `preview-running.png` | Build a mini-game |
| `mcp-panel.png` | MCP servers |
| `github-mcp-connected.png` | GitHub MCP |
| `skills-list.png` | Skills |
| `custom-endpoint-form.png` | Custom endpoints |
| `endpoint-in-dropdown.png` | Custom endpoints |
| `codex-subscription-connected.png` | ChatGPT subscription |
| `codex-subscription-code.png` | ChatGPT subscription |

### Conventions

- One fixed viewport (1280×800 works well) and **one theme** across all clips — dark reads best for a dev tool.
- GIFs: trim dead air, start on the action, end on the payoff, ≤15s, keep files small.
- Videos: MP4 with captions (many people watch muted). Blur any API keys / header values.
- Use a throwaway demo repo in a clean, staged state so reruns look identical and nothing personal leaks.

## Moving to a docs framework later

The `content/*.md` files are plain Markdown and port directly to Nextra / Docusaurus / Mintlify.
The `:::media` directive and internal `#/slug` links are the only two things to adapt for another
platform.
