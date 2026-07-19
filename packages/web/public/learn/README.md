# Background Agents — Learn docs

A self-contained docs site (Cursor `/learn` style). Plain Markdown content + a single-file
viewer. No build step, no dependencies, nothing to compile.

## View it locally

Run the web app (`npm run dev` from the repo root) and open:

```
http://localhost:4000/learn/index.html
```

Anything under `packages/web/public/` is served statically by Next, so this works with the dev
server as-is. (Open it through the server, not as a `file://` — the viewer fetches the Markdown.)

## Structure

```
learn/
  index.html            The whole viewer: sidebar, router, Markdown renderer, :::media directive.
  content/*.md          One Markdown file per page. Source of truth. Portable to any docs platform.
  media/                Screenshots (PNG) + 3 placeholder SVGs. Videos (MP4) and GIFs are hosted on
                        Cloudflare R2, not committed (see "Media hosting" below).
  media-config.js       Auto-generated at dev/build with the R2 base URL. Gitignored.
  README.md             This file.
```

To add or reorder pages, edit the `NAV` array near the top of the `<script>` in `index.html`.

## Media hosting

Big media (videos + GIFs) is served from a Cloudflare R2 bucket rather than committed to git —
`media/.gitignore` excludes `*.mp4` and `*.gif`. Screenshots (PNG) and the placeholder SVGs stay in `media/`.

- Set `NEXT_PUBLIC_LEARN_MEDIA_BASE` to the bucket URL (e.g. `https://pub-<hash>.r2.dev`, no trailing slash).
- On `predev`/`prebuild`, `scripts/gen-learn-media-config.mjs` materializes `media-config.js`, which sets
  `window.LEARN_MEDIA_BASE`. The viewer reads it as `R2_BASE` and resolves `*.mp4` → `${R2_BASE}/videos/<file>`
  and `*.gif` → `${R2_BASE}/gifs/<file>`.
- If the var is unset/empty, `media-config.js` holds an empty base and the viewer falls back to serving
  everything locally from `./media/`.

## The `:::media` directive

Media slots use a small directive instead of raw `<img>`/`<video>`:

```
:::media type="gif" file="Smithry-Mcp-connect.gif" duration="~12s"
Caption describing what the clip shows.
:::
```

- `type` is `video`, `gif`, or `image`.
- Until the real file resolves, a labeled **placeholder** renders automatically.
- **Add the real file with the exact `file` name and it appears — no Markdown edits.** Images (PNG) go in
  `media/`; videos (MP4) and GIFs resolve from R2 when `NEXT_PUBLIC_LEARN_MEDIA_BASE` is set, else from `media/`.
  (Images/GIFs fall back to the placeholder via `onerror`; videos use the placeholder as their poster.)

## Media status

Screenshots below are committed to `media/`. Videos and GIFs are hosted on R2 (see "Media hosting").

### Videos (narrated MP4) — hosted on R2 under `/videos/`

| File | Page | Shows |
|------|------|-------|
| `overview.mp4` | Overview | Product tour: create chat → pick agent → sandbox works → open PR |
| `coding-automation.mp4` | Issue → pull request | New GitHub issue fires the agent → it implements → opens a PR |
| `repo-less.mp4` | Daily email digest | Repo-less scheduled agent reads email → writes a digest to Notion |
| `gravity-game.mp4` | Build a mini-game | Prompt → agent builds a physics sandbox → playable in preview |
| `multi-agent-final.mp4` | Agent Battle | One "build Snake" prompt across Claude Code, Kimi Code, OpenCode |

### GIFs (silent, looping) — hosted on R2 under `/gifs/`

| File | Page | Shows |
|------|------|-------|
| `share-link.gif` | Overview | Create a share link → open the read-only public view |
| `connect-repo.gif` | Connect a repository | Connect a repo → new working branch |
| `Smithry-Mcp-connect.gif` | MCP servers | Search Smithery → connect → OAuth → tool available |
| `github-mcp-connect.gif` | GitHub MCP | Connect the GitHub MCP server → agent uses an issue/PR tool |
| `skill-install.gif` | Skills | Search skills.sh → install → skill available |
| `add-custom-endpoint.gif` | Custom endpoints | Add endpoint → fill fields → appears in model dropdown |

### Screenshots (PNG) — committed in `media/`

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

### Conventions

- One fixed viewport (1280×800 works well) and **one theme** across all clips — dark reads best for a dev tool.
- GIFs: trim dead air, start on the action, end on the payoff, ≤15s, keep files small.
- Videos: MP4 with captions (many people watch muted). Blur any API keys / header values.
- Use a throwaway demo repo in a clean, staged state so reruns look identical and nothing personal leaks.

## Moving to a standalone docs site later

The `content/*.md` files are plain Markdown and port directly to Nextra / Docusaurus / Mintlify.
The `:::media` directive and internal `#/slug` links are the only two things to adapt for another
platform.
