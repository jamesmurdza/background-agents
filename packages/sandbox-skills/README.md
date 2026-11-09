# @background-agents/sandbox-skills

Skills registry client and sandbox operations for Daytona sandboxes.

## Overview

This package provides:
- A registry client for searching the Skills.sh marketplace
- Sandbox operations for installing/uninstalling skills in Daytona environments
- Utilities for parsing CLI output

## Installation

```bash
npm install @background-agents/sandbox-skills @daytonaio/sdk
```

Inside this monorepo, it's also available to other packages as a workspace dependency:

```json
{
  "dependencies": {
    "@background-agents/sandbox-skills": "*"
  }
}
```

## Usage

### Search for Skills

```typescript
import { searchSkills, SKILLS_API_BASE } from "@background-agents/sandbox-skills/registry"

// Search the Skills.sh registry
const { results } = await searchSkills("react")

for (const skill of results) {
  console.log(`${skill.fullHandle} (${skill.installs} installs)`)
}
```

### Install Skills in a Sandbox

```typescript
import { Daytona } from "@daytonaio/sdk"
import { installSkill, uninstallSkill, listAvailableSkills } from "@background-agents/sandbox-skills/sandbox"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

// List the skills a source repo offers (returns a Set<string> of skill names, or null)
const available = await listAvailableSkills(sandbox, "/home/daytona/project", "owner/repo")

// Install a skill
const result = await installSkill(sandbox, "/home/daytona/project", "owner/repo", "skill-id")

// Uninstall a skill
await uninstallSkill(sandbox, "/home/daytona/project", "skill-id")
```

### Install a Predefined (Built-in) Skill

Predefined skills ship with this app — their content lives in
`@background-agents/predefined-skills` (`packages/predefined-skills/<id>/`),
not on the skills.sh marketplace. Installing one still goes through
`installSkill` under the hood: `installPredefinedSkill` just resolves the
id to this repo's own GitHub tree URL for that skill's folder.

```typescript
import { installPredefinedSkill, PREDEFINED_SKILLS } from "@background-agents/sandbox-skills"

// See what's available (id, name, description, path)
console.log(PREDEFINED_SKILLS)

// Install one by id
const result = await installPredefinedSkill(sandbox, "/home/daytona/project", "browser-mirror")
if (result.success) {
  console.log("Installed:", result.fullHandle) // "predefined/browser-mirror"
}
```

Adding a new predefined skill is two steps:
1. Add its folder (`SKILL.md` + assets) under `packages/predefined-skills/`.
2. Add a matching entry to `PREDEFINED_SKILLS` in `src/predefined-skills.ts`.

While this repo is mid-review and not yet on `main`, set
`PREDEFINED_SKILLS_BRANCH` to the PR's branch name so installs resolve
against the right ref; it defaults to `main` once unset.

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
} from "@background-agents/sandbox-skills"
```

### Registry Client

```typescript
import { searchSkills, SKILLS_API_BASE } from "@background-agents/sandbox-skills/registry"
```

### Sandbox Operations

```typescript
import {
  listAvailableSkills,
  installSkill,
  installSkillArchive,
  installSkills,
  parseSkillHandle,
  uninstallSkill,
  getSkillNameFromHandle,
  discoverInstalledSkills,
  installPredefinedSkill,
  type OnSkillRemove,
} from "@background-agents/sandbox-skills/sandbox"
```

### Predefined Skills Manifest

```typescript
import {
  PREDEFINED_SKILLS,
  PREDEFINED_SKILLS_REPO,
  predefinedSkillsBranch,
  getPredefinedSkill,
  buildPredefinedSkillUrl,
  type PredefinedSkill,
} from "@background-agents/sandbox-skills"
```

### Utilities

```typescript
import { stripAnsi, parseSkillList, extractCleanError } from "@background-agents/sandbox-skills/utils"
```

## Requirements

- Node.js >= 20.9.0
- `@daytonaio/sdk` >= 0.217.0 (peer dependency for sandbox operations)

## Tests

Unit tests live under `tests/sandbox/` (`discover.test.ts`, `install-archive.test.ts`) and mock `sandbox.process.executeCommand`, so they don't need a real sandbox or `DAYTONA_API_KEY`. There's no `test` script in this package's `package.json` yet, so run them directly with the hoisted `vitest`:

```bash
npm run typecheck
npx vitest run   # from packages/sandbox-skills
```

## License

Apache-2.0
