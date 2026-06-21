/**
 * @background-agents/common
 * Shared utilities and types for upstream-agents packages
 */

// Constants
export { PATHS, SANDBOX_CONFIG } from "./constants"

// Types
export type {
  ContentBlock,
  ToolCall,
} from "./types"

// Agent configuration
export {
  // Types
  type Agent,
  type ProviderName,
  type ProviderId,
  type ModelOption,
  type CredentialId,
  type CredentialFlags,
  type Credentials,
  // Data
  ALL_AGENTS,
  agentLabels,
  agentToProvider,
  agentModels,
  defaultAgentModel,
  agentSupportsPlanMode,
  // Functions
  getDefaultAgent,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  getModelLabel,
  getEnvForModel,
} from "./agents"

// GitHub client utilities
export {
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
} from "./github"

// Branch utilities
export { generateBranchName } from "./branch"

// Common utilities
export { cn } from "./utils"

// Slash commands
export {
  type SlashCommand,
  SLASH_COMMANDS,
  ABORT_COMMAND,
  filterSlashCommandsWithConflict,
} from "./slash-commands"

// Git operations
export {
  // Types
  type RebaseConflictState,
  // Functions
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
  // Constants
  EMPTY_CONFLICT_STATE,
} from "./git-operations"

// Agent icons
export {
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
} from "./agent-icons"

// Search palette
export {
  // Types
  type RecentItem,
  // Functions
  getRecentItems,
  addRecentItem,
} from "./search-palette"
