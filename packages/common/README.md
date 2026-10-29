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
  type ParsedCustomHeaders,
  type CredentialId,
  type CredentialFlags,
  type Credentials,
  type CustomEndpoint,
  type CustomEndpointType,
  // Data
  ALL_AGENTS,
  agentSlugs,
  agentLabels,
  agentToProvider,
  providerToAgent,
  agentModels,
  defaultAgentModel,
  agentSupportsPlanMode,
  ENDPOINT_TYPE_TO_AGENT,
  ENDPOINT_MODEL_PREFIX,
  // Functions
  getDefaultAgent,
  resolveAgentSlug,
  providerLabel,
  hasOwnAnthropicCredentials,
  sharedClaudePoolEligible,
  agentUsesSharedPool,
  sharedPoolProviderForModel,
  formatTokenRate,
  agentHasFreeUsage,
  agentSharedPoolExhausted,
  agentIsReady,
  hasCredentialsForModel,
  modelRequiresKey,
  getDefaultModelForAgent,
  getFreeModelForAgent,
  getAgentModels,
  getModelLabel,
  getEnvForModel,
  findEndpoint,
  buildEndpointEnv,
  buildCustomModelEnv,
  buildCodexCustomEnv,
  buildOpencodeCustomEnv,
  parseCustomHeaders,
  resolveCliModel,
  resolveModelForAgent,
  resolveChatModel,
  resolveAgent,
  resolveAgentAndModel,
} from "@background-agents/common"
```

### Codex Model Defaults

Codex defaults to `gpt-6.1-sol` (`gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`,
and `gpt-6-luna` are also offered). GPT-5.5 was retired from ChatGPT sign-in
on Oct 14, 2026, not from the API — it's still offered, but gated to an
OpenAI API key (`requiresKey: "openai"`, labeled "GPT-5.5 (API key only)").
When a ChatGPT subscription is connected it takes precedence over an API key,
matching the SDK's authentication route, so a subscription-backed run never
falls back to GPT-5.5 even if an API key is also present. Saved GPT-5.5
preferences and chat selections resolve to the current default once a
subscription is connected; custom-endpoint choices are preserved. This
resolution does not send prompts or rewrite chat history. Credential checks
do not prove account/plan access to a particular model; a provider rejection
still needs the explicit model-selection recovery flow.

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
  isValidRepoName,
  // High-level API methods
  getUser,
  getUserRepos,
  getRepo,
  getRepoBranches,
  compareBranches,
  createRepo,
  createPullRequest,
  forkRepo,
} from "@background-agents/common"
```

### Content Block Types

Types for structured agent responses.

```typescript
import type {
  ContentBlock,
  ToolCall,
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
  CREATE_REPO_COMMAND,
  filterSlashCommandsWithConflict,
  filterSingleCommand,
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
  CommandCodeIcon,
  CopilotIcon,
  DroidIcon,
  OpenCodeIcon,
  GeminiIcon,
  GooseIcon,
  KiloIcon,
  KimiIcon,
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

Apache-2.0
