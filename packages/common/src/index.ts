/**
 * @upstream/common
 * Shared utilities and types for upstream-agents packages
 */

// Constants
export { PATHS, SANDBOX_CONFIG, TIMEOUTS } from "./constants"

// Types
export type {
  ContentBlock,
  ToolCall,
  AgentStatus,
  AgentStatusResponse,
} from "./types"

// Session utilities
export {
  mapToolName,
  buildSystemPrompt,
  buildContentBlocks,
  type BuildContentBlocksResult,
} from "./session"

// Agent configuration
export {
  // Types
  type Agent,
  type ProviderName,
  type ModelOption,
  type UserCredentialFlags,
  // Data
  agentToProvider,
  agentLabels,
  agentModels,
  defaultAgentModel,
  // Functions
  getProviderForAgent,
  getDefaultAgent,
  hasClaudeCodeCredentials,
  hasCodexCredentials,
  hasGeminiCredentials,
  hasGooseCredentials,
  hasPiCredentials,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  getModelLabel,
} from "./agents"

// SSE utilities
export {
  // Types
  type SSEEvent,
  type StreamController,
  type StreamOptions,
  type ProgressEvent,
  type ErrorEvent,
  type DoneEvent,
  type StreamEvent,
  // Constants
  SSE_HEADERS,
  // Server-side
  createSSEStream,
  sendProgress,
  sendError,
  sendDone,
  // Client-side
  parseSSEStream,
  waitForSSEResult,
} from "./sse"

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
  githubFetchText,
  isGitHubApiError,
  // High-level API methods
  getUser,
  getUserRepos,
  getRepo,
  getRepoBranches,
  compareBranches,
  getDiff,
  createRepo,
  forkRepo,
  createPullRequest,
} from "./github"

// Branch utilities
export {
  // Constants
  BRANCH_NAME_WORDS,
  BRANCH_NAME_ERRORS,
  // Types
  type BranchNameWord,
  type BranchNameError,
  type BranchNameOptions,
  // Functions
  generateBranchName,
  randomBranchName,
  validateBranchName,
} from "./branch"

// Sandbox utilities
export { generateSandboxName } from "./sandbox"

// Common utilities
export { cn, formatRelativeTime } from "./utils"
