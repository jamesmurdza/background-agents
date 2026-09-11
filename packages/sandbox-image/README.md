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

## How the agent CLIs stay current

The agent CLIs are installed **unpinned**, so each one is frozen at whatever version was latest when the snapshot was last built. `tokscale` is the exception: it is pinned via `TOKSCALE_VERSION` because the app parses its output.

That freeze matters because the model catalog (`packages/common/src/agents.ts`) ships with every deploy, while the CLI that has to run those models only moves when the snapshot is rebuilt. Let the two drift and users hit errors like:

```
The 'gpt-5.6-sol' model requires a newer version of Codex.
Please upgrade to the latest app or CLI and try again.
```

The app offered a model the baked CLI was too old to run.

So the snapshot is rebuilt **weekly** by `.github/workflows/rebuild-snapshot.yml` (Sundays 09:00 UTC, or on demand via "Run workflow"). It needs a `DAYTONA_API_KEY` repository secret. The rebuild is zero-downtime and safe to run against a live app — see `rebuildSnapshot`.

Two consequences worth knowing:

- **A new CLI release reaches production without anyone approving it.** That is the deliberate trade: upstream breakage is rarer and easier to spot than the silent version drift it replaces. If a release does break things, pin that one package in `AGENT_PACKAGES` the way `TOKSCALE_VERSION` is pinned, and unpin it once upstream is fixed.
- **A failed run is not an outage.** New sandboxes keep launching from the previous snapshot. It only means the CLIs are ageing, so a red workflow is worth fixing but not paging anyone.

To rebuild by hand:

```bash
npm run build:snapshot
```

## Installation

This is an internal workspace package. It's automatically available to other packages in the monorepo:

```json
{
  "dependencies": {
    "@background-agents/sandbox-image": "*"
  }
}
```

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import {
  getAgentSandboxImage,
  SNAPSHOT_NAME,
  SNAPSHOT_RESOURCES,
} from "@background-agents/sandbox-image"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

// Create a sandbox from the pre-built image
const sandbox = await daytona.create({
  image: getAgentSandboxImage(),
  resources: SNAPSHOT_RESOURCES,
})
```

## Exports

```typescript
import {
  getAgentSandboxImage, // Builds the Daytona Image spec
  AGENT_PACKAGES,       // Map of agent name -> npm package
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

- Node.js >= 18
- `@daytonaio/sdk` >= 0.170.0
