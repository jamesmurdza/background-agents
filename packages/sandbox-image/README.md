# @background-agents/sandbox-image

Custom [Daytona](https://daytona.io) sandbox image with pre-installed AI coding agent CLIs.

## Overview

This package builds a Daytona `Image` spec with the supported agent CLIs baked in, so sandbox startup is fast and predictable. Agents do not have to be installed on every new sandbox.

Pre-installed agents:

- **Claude Code** (`@anthropic-ai/claude-code@2.1.283`)
- **Codex** (`@openai/codex@0.159.3`)
- **Command Code** (`command-code`)
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

Claude Code is pinned to the version verified by the SDK's shared OAuth recovery test because that feature uses an internal CLI callback. Keep `AGENT_PACKAGES.claude` in sync with `CLAUDE_CODE_VERSION` in `packages/sdk/src/utils/install.ts`, and run `packages/sdk/tests/integration/claude-oauth-retry.integration.test.ts` against the proposed version before updating either pin. Rebuild the snapshot with `npm run build:snapshot` to bake in an updated version. Existing sandboxes are not changed by a snapshot rebuild; the SDK checks and updates their CLI to the pin when starting a shared OAuth run.

## Installation

Codex is pinned to `CODEX_CLI_VERSION` in `src/image.ts` and the SDK's
`src/utils/install.ts`. Update or revert both pins in a reviewed PR. The image
preinstalls the versioned runtime used by the SDK and links the terminal's
`codex` command to it. Rebuilding the image affects new sandboxes only; the SDK
selects the exact reviewed version before a new execution in existing sandboxes,
without replacing active jobs (see `packages/sdk/src/utils/codex-runtime.ts`).
This package does not schedule automatic upgrades; other agents' existing
installation policies are unchanged.

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
import { getActiveSnapshotName } from "@background-agents/sandbox-image"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

// Create a sandbox from the pre-built, pre-installed snapshot
const sandbox = await daytona.create({
  snapshot: await getActiveSnapshotName(daytona),
})
```

`getAgentSandboxImage()` and `SNAPSHOT_RESOURCES` are used internally (by `rebuildSnapshot()`, i.e. `npm run build:snapshot`) to build that snapshot via `daytona.snapshot.create({ name, image: getAgentSandboxImage(), resources: SNAPSHOT_RESOURCES })` — sandboxes are then created from the resulting snapshot name, not from the `Image` spec directly.

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

- Node.js >= 20.9.0 (per the repo root's `engines.node`)
- `@daytonaio/sdk` ^0.170.0
