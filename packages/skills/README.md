# @upstream/skills

Skills registry client and sandbox operations for Daytona sandboxes.

## Overview

This package provides:
- A registry client for searching the Skills.sh marketplace
- Sandbox operations for installing/uninstalling skills in Daytona environments
- Utilities for parsing CLI output

## Installation

This is an internal workspace package. It's automatically available to other packages in the monorepo:

```json
{
  "dependencies": {
    "@upstream/skills": "*"
  }
}
```

## Usage

### Search for Skills

```typescript
import { searchSkills, SKILLS_API_BASE } from "@upstream/skills/registry"

// Search the Skills.sh registry
const { results } = await searchSkills("react")

for (const skill of results) {
  console.log(`${skill.name}: ${skill.description}`)
}
```

### Install Skills in a Sandbox

```typescript
import { Daytona } from "@daytonaio/sdk"
import { installSkill, uninstallSkill, listAvailableSkills } from "@upstream/skills/sandbox"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

// List available skills in a repository
const skills = await listAvailableSkills(sandbox, "/home/daytona/project")

// Install a skill
const result = await installSkill(sandbox, "/home/daytona/project", "owner/repo", "skill-id")

// Uninstall a skill
await uninstallSkill(sandbox, "/home/daytona/project", "skill-id")
```

## Exports

### Types

```typescript
import type {
  SkillsApiResult,
  SkillSearchResult,
  SkillSearchResponse,
  SkillInstallResult,
  SkillsInstallResult,
  SkillRecord,
  DiscoveredSkill,
} from "@upstream/skills"
```

### Registry Client

```typescript
import { searchSkills, SKILLS_API_BASE } from "@upstream/skills/registry"
```

### Sandbox Operations

```typescript
import {
  listAvailableSkills,
  installSkill,
  installSkills,
  parseSkillHandle,
  uninstallSkill,
  getSkillNameFromHandle,
  discoverInstalledSkills,
  type OnSkillRemove,
} from "@upstream/skills/sandbox"
```

### Utilities

```typescript
import { stripAnsi, parseSkillList, extractCleanError } from "@upstream/skills/utils"
```

## Requirements

- Node.js >= 18
- `@daytonaio/sdk` >= 0.170.0 (peer dependency for sandbox operations)

## License

MIT
