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
  AgentStatus,
  AgentStatusResponse,
} from "./types"

// Agent configuration
export {
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
  agentLabels,
  agentToProvider,
  agentModels,
  defaultAgentModel,
  agentSupportsPlanMode,
  ENDPOINT_TYPE_TO_AGENT,
  ENDPOINT_MODEL_PREFIX,
  // Functions
  getDefaultAgent,
  hasOwnAnthropicCredentials,
  sharedClaudePoolEligible,
  agentUsesSharedPool,
  agentHasFreeUsage,
  agentSharedPoolExhausted,
  agentIsReady,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  resolveModelForAgent,
  resolveAgent,
  resolveAgentAndModel,
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
  DroidIcon,
  OpenCodeIcon,
  GeminiIcon,
  GooseIcon,
  KiloIcon,
  KimiIcon,
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
