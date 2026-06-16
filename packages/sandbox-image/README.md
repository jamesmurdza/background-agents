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
  SNAPSHOT_NAME,        // Registered snapshot name ("background-agents")
  SNAPSHOT_RESOURCES,   // { cpu, memory, disk } defaults
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
