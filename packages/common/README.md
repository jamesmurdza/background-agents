# @background-agents/common

Shared utilities and types for the `@background-agents` packages. This package provides common functionality used across the monorepo, including agent configuration, GitHub API helpers, and utility functions.

## Installation

This is an internal workspace package. It's automatically available to other packages in the monorepo:

```json
{
  "dependencies": {
    "@background-agents/common": "*"
  }
}
```

## Exports

### Agent Configuration

Defines supported AI coding agents, their providers, and model options.

```typescript
import {
  // Types
  type Agent,
  type ProviderName,
  type ProviderId,
  type ModelOption,
  type CredentialId,
  type CredentialFlags,
  type Credentials,
  type ParsedCustomHeaders,
  // Data
  ALL_AGENTS,
  agentLabels,
  agentToProvider,
  agentModels,
  defaultAgentModel,
  agentSupportsPlanMode,
  CUSTOM_MODEL_VALUE,
  // Functions
  getDefaultAgent,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  getModelLabel,
  getEnvForModel,
  buildCustomModelEnv,
  parseCustomHeaders,
  resolveCliModel,
} from "@background-agents/common"
```

### GitHub API Helpers

Type-safe GitHub API client utilities.

```typescript
import {
  // Types
  type GitHubApiError,
  type GitHubUser,
  type GitHubRepo,
  type GitHubBranch,
  type GitHubCompareResult,
  type GitHubPullRequest,
  // Core helpers
  githubFetch,
  isGitHubApiError,
  // High-level API methods
  getUser,
  getUserRepos,
  getRepo,
  getRepoBranches,
  compareBranches,
  createRepo,
  createPullRequest,
  createFileCommit,
  forkRepo,
} from "@background-agents/common"
```

### Content Block Types

Types for structured agent responses.

```typescript
import type {
  ContentBlock,
  ToolCall,
  AgentStatus,
  AgentStatusResponse,
} from "@background-agents/common"
```

### Branch Utilities

Generate Git branch names.

```typescript
import { generateBranchName } from "@background-agents/common"
```

### Git Operations

Helpers for common Git operations.

```typescript
import {
  // Types
  type RebaseConflictState,
  // Functions
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
  // Constants
  EMPTY_CONFLICT_STATE,
} from "@background-agents/common"
```

### Slash Commands

Command definitions and filtering.

```typescript
import {
  type SlashCommand,
  SLASH_COMMANDS,
  ABORT_COMMAND,
  filterSlashCommandsWithConflict,
} from "@background-agents/common"
```

### Common Utilities

```typescript
import { cn } from "@background-agents/common"
```

### Constants

```typescript
import { PATHS, SANDBOX_CONFIG } from "@background-agents/common"
```

### Agent Icons

React components for displaying agent icons.

```typescript
import {
  ClaudeCodeIcon,
  CodexIcon,
  CopilotIcon,
  OpenCodeIcon,
  GeminiIcon,
  GooseIcon,
  KiloIcon,
  ElizaIcon,
  PiIcon,
  AgentIcon,
} from "@background-agents/common"
```

### Search Palette

Utilities for managing recent search items.

```typescript
import {
  type RecentItem,
  getRecentItems,
  addRecentItem,
} from "@background-agents/common"
```

## Development

```bash
# Build the package
npm run build

# Type check
npm run typecheck
```

## License

MIT
