---
name: browser-mirror
description: Run a headless browser and mirror what it's doing live to a webpage on a local port, so a human can watch browser automation happen in real time.
---

# Browser Mirror

Launches a headless Chromium browser via Playwright, drives it through a
scripted sequence of actions, and streams a live, continuously-updating view
of the browser to a plain webpage served on a local port — no browser
extension or remote-desktop software required.

## How it works

- Uses the Chrome DevTools Protocol (CDP) `Page.startScreencast` command to
  receive a stream of JPEG frames as the headless page renders.
- Broadcasts each frame over a WebSocket to any browser tab that has the
  viewer page open.
- The viewer page is intentionally minimal: just the live image, centered,
  on a light checkerboard background, with a loading spinner shown until the
  first frame arrives.

## Running it

```bash
cd packages/predefined-skills/browser-mirror
npm install   # if dependencies aren't already hoisted at the repo root
npx playwright install chromium   # one-time browser binary install
node mirror.js
```

This starts an HTTP+WebSocket server on port `4502` (edit the `PORT` constant
in `mirror.js` to change it) and immediately begins looping through a sample
navigation sequence (loads a page, scrolls, clicks a link, goes back,
repeats).

Open `http://localhost:4502` (or the equivalent preview URL, if running in a
sandboxed environment that proxies local ports) to watch it live.

## Adapting it

To mirror a different automated flow, replace the `while (true) { ... }`
block near the bottom of `mirror.js` with whatever Playwright actions you
want to run — the screencast/mirroring code above it does not need to
change.

This skill intentionally does not forward any input back into the browser —
it's a one-way, view-only mirror. See the project's chat history / commit log
for a variant that adds two-way control if that's ever needed again.
