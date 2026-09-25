# @background-agents/sandbox-image

Custom [Daytona](https://daytona.io) sandbox image with pre-installed AI coding agent CLIs.

## Overview

This package builds a Daytona `Image` spec with the supported agent CLIs baked in, so sandbox startup is fast and predictable. Agents do not have to be installed on every new sandbox.

Pre-installed agents:

- **Claude Code** (`@anthropic-ai/claude-code`)
- **Codex** (`@openai/codex`)
- **Copilot** (`@github/copilot`)
- **Kilo** (`@kilocode/cli`)
- **OpenCode** (`opencode-ai`)
- **Gemini** (`@google/gemini-cli`)
- **Pi** (`@mariozechner/pi-coding-agent`)
- **Goose** (binary from GitHub releases)
- **Kimi** (shell-script installer from `code.kimi.com`)
- **Droid** (Factory, shell-script installer from `app.factory.ai/cli`)

The image also pre-installs [`tokscale`](https://www.npmjs.com/package/tokscale) (pinned via `TOKSCALE_VERSION`) for post-turn token/cost metering.

The image is based on `node:22-bookworm` and runs as a non-root `daytona` user (Claude Code refuses to run as root).

## Installation

This is an internal workspace package. It's automatically available to other packages in the monorepo:

```json
{
  "dependencies": {
    "@background-agents/sandbox-image": "*"
  }
}
```

## Building the snapshot

The `Image` spec is baked into a named Daytona snapshot ahead of time. Build it from
the repo root (requires `DAYTONA_API_KEY`):

```bash
npm run build:snapshot
```

That runs `rebuildSnapshot()`, which builds into `SNAPSHOT_NAME_TEMP` first and only
then promotes it, so an existing snapshot keeps serving sandboxes while the new one
builds.

## Usage

Sandboxes should be created *from the snapshot* — that's the whole point of the
package, and it's what `packages/web` does:

```typescript
import { Daytona } from "@daytonaio/sdk"
import {
  getActiveSnapshotName,
  SNAPSHOT_RESOURCES,
} from "@background-agents/sandbox-image"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

// Launch from the pre-built snapshot (fast path)
const sandbox = await daytona.create({
  snapshot: await getActiveSnapshotName(daytona),
})
```

`getActiveSnapshotName()` throws if no snapshot is in the `active` state — run
`npm run build:snapshot` first.

Passing `image: getAgentSandboxImage()` instead builds the image at create time.
That's useful for one-off experiments, but it's slow — it defeats the purpose of the
snapshot:

```typescript
const sandbox = await daytona.create({
  image: getAgentSandboxImage(),
  resources: SNAPSHOT_RESOURCES,
})
```

## Exports

```typescript
import {
  getAgentSandboxImage, // Builds the Daytona Image spec
  AGENT_PACKAGES,       // npm package per npm-installed agent (not a full agent list:
                        // kimi is "", and goose/droid aren't installed via npm)
  TOKSCALE_VERSION,     // Pinned tokscale (token/cost metering) CLI version
  SNAPSHOT_NAME,        // Canonical snapshot name ("background-agents")
  SNAPSHOT_NAME_TEMP,   // Transient scratch name used only during a rebuild
  ALL_SNAPSHOT_NAMES,   // All known snapshot names
  getActiveSnapshotName,// Resolves the ready ("active") snapshot to serve
  SNAPSHOT_RESOURCES,   // { cpu, memory, disk } defaults
  rebuildSnapshot,      // Rebuilds the snapshot from the current Image spec
} from "@background-agents/sandbox-image"

import type {
  RebuildSnapshotOptions, // Options for rebuildSnapshot
} from "@background-agents/sandbox-image"
```

### Default resources

| Resource | Value |
|----------|-------|
| CPU      | 1 vCPU |
| Memory   | 3 GB  |
| Disk     | 5 GB  |

## Requirements

- Node.js >= 20.9 (the monorepo floor; see the root [README](../../README.md#prerequisites))
- `@daytonaio/sdk` >= 0.170.0
