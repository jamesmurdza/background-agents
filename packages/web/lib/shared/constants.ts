/**
 * Application-wide constants and enums
 * Centralizes magic strings and values used across the codebase
 */

// =============================================================================
// Branch/Sandbox Status
// =============================================================================

export const BRANCH_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  CREATING: "creating",
  ERROR: "error",
  STOPPED: "stopped",
} as const

export type BranchStatus = (typeof BRANCH_STATUS)[keyof typeof BRANCH_STATUS]

// =============================================================================
// Delete Modal Merge Status
// =============================================================================

export const MERGE_STATUS = {
  LOADING: "loading",
  MERGED: "merged",
  UNMERGED: "unmerged",
  NOT_FOUND: "not_found",
  ERROR: "error",
} as const

export type MergeStatus = (typeof MERGE_STATUS)[keyof typeof MERGE_STATUS]

// =============================================================================
// Agent Execution Status
// =============================================================================

export const EXECUTION_STATUS = {
  RUNNING: "running",
  COMPLETED: "completed",
  ERROR: "error",
} as const

export type ExecutionStatus = (typeof EXECUTION_STATUS)[keyof typeof EXECUTION_STATUS]

/** Throttle for status-driven sandbox polling (ms). Used in serverless so any instance can poll. */
export const SNAPSHOT_POLL_THROTTLE_MS = 500

// =============================================================================
// Message Roles
// =============================================================================

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE]

/** Stored on Message when role is assistant — see `Message.assistantSource`. */
export const ASSISTANT_SOURCE = {
  MODEL: "model",
  SYSTEM: "system",
  COMMIT: "commit",
} as const

// =============================================================================
// Content Block Types
// =============================================================================

export const CONTENT_BLOCK_TYPE = {
  TEXT: "text",
  TOOL_CALLS: "tool_calls",
} as const

export type ContentBlockType = (typeof CONTENT_BLOCK_TYPE)[keyof typeof CONTENT_BLOCK_TYPE]

// =============================================================================
// Random Branch Name Generation
// =============================================================================

/**
 * Word list for generating random branch names
 * Used to create memorable, human-readable branch names like "swift-lunar-amber"
 */
export const BRANCH_NAME_WORDS = [
  "swift",
  "lunar",
  "amber",
  "coral",
  "ember",
  "frost",
  "bloom",
  "spark",
  "drift",
  "pulse",
  "cedar",
  "maple",
  "river",
  "stone",
  "cloud",
  "flame",
  "steel",
  "light",
  "storm",
  "wave",
  "tiger",
  "eagle",
  "brave",
  "vivid",
  "noble",
  "rapid",
  "quiet",
  "sharp",
  "fresh",
  "grand",
] as const

export type BranchNameWord = (typeof BRANCH_NAME_WORDS)[number]

// =============================================================================
// Anthropic Auth Types
// =============================================================================

export const ANTHROPIC_AUTH_TYPE = {
  API_KEY: "api-key",
  CLAUDE_MAX: "claude-max",
} as const

export type AnthropicAuthType = (typeof ANTHROPIC_AUTH_TYPE)[keyof typeof ANTHROPIC_AUTH_TYPE]

// =============================================================================
// API Timeouts (in milliseconds)
// =============================================================================

export const TIMEOUTS = {
  /** Agent query timeout - 5 minutes */
  AGENT_QUERY: 300_000,
  /** Sandbox creation timeout - 5 minutes */
  SANDBOX_CREATE: 300_000,
  /** Agent execution timeout - 1 minute */
  AGENT_EXECUTE: 60_000,
  /** Git operation timeout - 1 minute */
  GIT_OPERATION: 60_000,
  /** Default API timeout - 2 minutes */
  DEFAULT_API: 120_000,
  /** Polling interval for status checks - 1 second */
  POLLING_INTERVAL: 1_000,
} as const

// =============================================================================
// Pagination Limits
// =============================================================================

export const PAGINATION = {
  /** Maximum repos to return in user/me endpoint */
  REPOS_PER_USER: 20,
  /** Maximum repos to return in repos list endpoint */
  REPOS_LIST: 50,
  /** Maximum branches per repo in list views */
  BRANCHES_PER_REPO: 10,
  /** Maximum messages to return per request */
  MESSAGES_PER_REQUEST: 100,
  /** GitHub API default per_page value */
  GITHUB_API_PER_PAGE: 50,
  /** GitHub branches pagination per page */
  GITHUB_BRANCHES_PER_PAGE: 100,
  /** Maximum git log commits */
  GIT_LOG_COMMITS: 30,
  /** Maximum sandboxes to update in batch operations */
  SANDBOX_BATCH_LIMIT: 100,
} as const

// =============================================================================
// Quota and Limits
// =============================================================================

export const QUOTA = {
  /** Default maximum concurrent sandboxes per user */
  MAX_CONCURRENT_SANDBOXES: 5,
  /** Minimum auto-stop interval in minutes */
  AUTO_STOP_INTERVAL_MIN: 5,
  /** Maximum auto-stop interval in minutes */
  AUTO_STOP_INTERVAL_MAX: 20,
  /** Default auto-stop interval in minutes */
  AUTO_STOP_INTERVAL_DEFAULT: 5,
  /** SSH access duration in minutes */
  SSH_ACCESS_DURATION: 60,
} as const

// =============================================================================
// Paths
// =============================================================================

export const PATHS = {
  /** Base directory for repo clones in sandbox */
  SANDBOX_HOME: "/home/daytona",
  /** Directory for agent log files */
  LOGS_DIR: "/tmp/logs",
  /** Claude credentials directory */
  CLAUDE_CREDENTIALS_DIR: "/home/daytona/.claude",
  /** Claude credentials file */
  CLAUDE_CREDENTIALS_FILE: "/home/daytona/.claude/.credentials.json",
  /** Claude hooks directory */
  CLAUDE_HOOKS_DIR: "/home/daytona/.claude/hooks",
  /** Claude settings file */
  CLAUDE_SETTINGS_FILE: "/home/daytona/.claude/settings.json",
  /** Agent session ID persistence file */
  AGENT_SESSION_FILE: "/home/daytona/.agent_session_id",
  /** MCP config paths per agent */
  MCP_CONFIG: {
    "claude-code": "/home/daytona/.claude.json",
    "opencode": "/home/daytona/.config/opencode/opencode.jsonc",
    "codex": "/home/daytona/.codex/config.toml",
    "gemini": "/home/daytona/.gemini/settings.json",
  },
} as const

// =============================================================================
// Sandbox Configuration
// =============================================================================

export const SANDBOX_CONFIG = {
  /** Default snapshot for sandbox creation */
  DEFAULT_SNAPSHOT: "daytona-medium",
  /** Label key for identifying upstream-agents sandboxes */
  LABEL_KEY: "upstream-agents",
  /** Default preview port */
  DEFAULT_PREVIEW_PORT: 3000,
  /** Timeout in seconds for starting sandbox */
  START_TIMEOUT_SECONDS: 120,
} as const

// =============================================================================
// GitHub API
// =============================================================================

export const GITHUB_API = {
  /** Base URL for GitHub API */
  BASE_URL: "https://api.github.com",
  /** Default Accept header for GitHub API v3 */
  ACCEPT_HEADER: "application/vnd.github.v3+json",
  /** Accept header for diff responses */
  ACCEPT_DIFF_HEADER: "application/vnd.github.v3.diff",
} as const
