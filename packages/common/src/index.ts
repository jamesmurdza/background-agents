/**
 * @upstream/common
 * Shared utilities and types for upstream-agents packages
 */

// Constants
export { PATHS, SANDBOX_CONFIG, TIMEOUTS, ENV_VARS } from "./constants"

// Types
export type {
  ContentBlock,
  ToolCall,
  AgentStatus,
  AgentStatusResponse,
} from "./types"

// Session utilities
export {
  buildSystemPrompt,
  buildContentBlocks,
  type BuildContentBlocksResult,
} from "./session"

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
  agentModels,
  defaultAgentModel,
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
} from "./github"

// Branch utilities
export {
  // Types
  type BranchNameOptions,
  // Functions
  generateBranchName,
} from "./branch"

// Sandbox utilities
export { generateSandboxName } from "./sandbox"

// Common utilities
export { cn, formatRelativeTime } from "./utils"

// Slash commands
export {
  type SlashCommand,
  SLASH_COMMANDS,
  ABORT_COMMAND,
  filterSlashCommands,
  filterSlashCommandsWithConflict,
} from "./slash-commands"

// Git operations
export {
  // Types
  type RebaseConflictState,
  type GitStatusResult,
  type MergeResult,
  type RebaseResult,
  type GitOperationContext,
  type SandboxProcessExecutor,
  // Functions
  formatPRTitleFromBranch,
  formatPRBodyFromCommits,
  isGitNothingToCommitMessage,
  parseConflictedFiles,
  createAuthenticatedUrl,
  fetchBranchWithAuth,
  // Constants
  EMPTY_CONFLICT_STATE,
} from "./git-operations"

// Agent icons
export {
  ClaudeCodeIcon,
  CodexIcon,
  OpenCodeIcon,
  GeminiIcon,
  GooseIcon,
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
