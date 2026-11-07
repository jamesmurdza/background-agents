---
name: browser-mirror
description: Run a headless browser that you can drive one action at a time via a local HTTP API, while a human watches everything happen live on a webpage on a local port.
---

# Browser Mirror

Launches a headless Chromium browser via Playwright, streams a live view of
it to a plain webpage on a local port, and exposes a simple HTTP control API
so an agent can drive the browser action-by-action — navigate, click, type,
scroll, read page content — while a human watches it happen in real time.
No browser extension or remote-desktop software required.

## How it works

- Uses the Chrome DevTools Protocol (CDP) `Page.startScreencast` command to
  receive a stream of JPEG frames as the headless page renders.
- Broadcasts each frame over a WebSocket to any browser tab that has the
  viewer page open. The viewer page is intentionally minimal: just the live
  image, centered, on a light checkerboard background, with a loading
  spinner shown until the first frame arrives.
- Exposes `POST /control` on the same server. Every control call acts on
  the same long-lived Playwright `page` the screencast is streaming, so the
  human watching the viewer page sees each action land as it happens.

## Running it

```bash
cd packages/predefined-skills/browser-mirror
npm install   # if dependencies aren't already hoisted at the repo root
npx playwright install chromium   # one-time browser binary install
node mirror.js
```

This starts the server on port `4502` (edit the `PORT` constant in
`mirror.js` to change it) and opens a blank page, waiting for commands.

Open `http://localhost:4502` (or the equivalent preview URL, if running in a
sandboxed environment that proxies local ports) to watch it live. Leave that
tab open while issuing control commands below.

## Driving the browser

Send actions as JSON to `POST /control`:

```bash
curl -s localhost:4502/control -d '{"action":"goto","url":"https://example.com"}'
curl -s localhost:4502/control -d '{"action":"click","selector":"#submit"}'
curl -s localhost:4502/control -d '{"action":"type","selector":"input[name=q]","text":"hello"}'
curl -s localhost:4502/control -d '{"action":"press","key":"Enter"}'
curl -s localhost:4502/control -d '{"action":"scroll","deltaY":400}'
curl -s localhost:4502/control -d '{"action":"waitForSelector","selector":".results"}'
curl -s localhost:4502/control -d '{"action":"wait","ms":1000}'
curl -s localhost:4502/control -d '{"action":"evaluate","script":"document.title"}'
curl -s localhost:4502/control -d '{"action":"status"}'
curl -s localhost:4502/control -d '{"action":"screenshot"}'
```

(`curl` needs `-H "Content-Type: application/json"` on hosts where it
doesn't infer that from `-d` automatically.)

| action | params | what it does |
|---|---|---|
| `goto` | `url` | Navigate to a URL |
| `click` | `selector`, `timeout?` | Click the first matching element |
| `type` | `selector`, `text`, `timeout?` | Fill an input/textarea |
| `press` | `key`, `selector?` | Press a key (optionally focusing a selector first) |
| `scroll` | `deltaX?`, `deltaY?` | Scroll the page |
| `waitForSelector` | `selector`, `timeout?` | Wait until an element appears |
| `wait` | `ms?` | Plain delay |
| `evaluate` | `script` | Run a JS expression in the page, returns the result (must be JSON-serializable) |
| `status` | — | Returns the current URL and title |
| `screenshot` | — | Returns a base64 JPEG of the current page (useful for an agent that can't see the viewer page itself) |

Every response is `{ "success": true, ... }` or
`{ "success": false, "error": "..." }` — check `success` rather than
assuming a 200 means the action worked as intended (e.g. a `click` on a
selector that matched but was covered by another element still reports
`success: true`, since Playwright itself didn't throw).

## Why this shape

Earlier versions of this skill ran one hardcoded demo sequence. A fixed
script isn't a reusable skill — it can only ever do the one thing it was
written to do. Separating "stream what the browser is doing" from "decide
what the browser does next" means the same server works for any task: log
into a site, fill out a form, scrape a page, walk through a UI flow for a
bug report — all without touching `mirror.js` itself.

This skill intentionally does not forward a *human's* mouse/keyboard input
into the browser — it's control via the HTTP API only, so an agent (not
just a human with a mouse) can drive it the same way.
