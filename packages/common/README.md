# @upstream/common

Shared utilities and types for upstream-agents packages. This package provides common functionality used across the monorepo, including agent configuration, GitHub API helpers, and utility functions.

## Installation

This is an internal workspace package. It's automatically available to other packages in the monorepo:

```json
{
  "dependencies": {
    "@upstream/common": "*"
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
  type ModelOption,
  type CredentialFlags,
  // Data
  agentLabels,
  agentModels,
  defaultAgentModel,
  // Functions
  getDefaultAgent,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  getModelLabel,
} from "@upstream/common"
```

### GitHub API Helpers

Type-safe GitHub API client utilities.

```typescript
import {
  // Types
  type GitHubApiError,
  type GitHubFetchOptions,
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
} from "@upstream/common"
```

### Session Utilities

Helpers for building agent sessions and content blocks.

```typescript
import {
  buildSystemPrompt,
  buildContentBlocks,
  type BuildContentBlocksResult,
} from "@upstream/common"
```

### Content Block Types

Types for structured agent responses.

```typescript
import type {
  ContentBlock,
  ToolCall,
  AgentStatus,
  AgentStatusResponse,
} from "@upstream/common"
```

### Branch Utilities

Generate Git branch names.

```typescript
import {
  // Types
  type BranchNameOptions,
  // Functions
  generateBranchName,
} from "@upstream/common"
```

### Git Operations

Helpers for common Git operations.

```typescript
import {
  // Types
  type RebaseConflictState,
  type GitStatusResult,
  type MergeResult,
  type RebaseResult,
  type GitOperationContext,
  // Functions
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
  isGitNothingToCommitMessage,
  parseConflictedFiles,
  // Constants
  EMPTY_CONFLICT_STATE,
} from "@upstream/common"
```

### Sandbox Utilities

```typescript
import { generateSandboxName } from "@upstream/common"
```

### Slash Commands

Command definitions and filtering.

```typescript
import {
  type SlashCommand,
  SLASH_COMMANDS,
  filterSlashCommands,
  filterSlashCommandsWithConflict,
} from "@upstream/common"
```

### Common Utilities

```typescript
import { cn, formatRelativeTime } from "@upstream/common"
```

### Constants

```typescript
import { PATHS, SANDBOX_CONFIG, TIMEOUTS, ENV_VARS } from "@upstream/common"
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
