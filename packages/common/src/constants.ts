/**
 * Shared constants for upstream-agents packages
 */

// =============================================================================
// Paths
// =============================================================================

export const PATHS = {
  /** Base directory for repo clones in sandbox */
  SANDBOX_HOME: "/home/daytona",
  /** Directory where the repository is cloned */
  PROJECT_DIR: "/home/daytona/project",
  /** Directory for agent log files */
  LOGS_DIR: "/tmp/logs",
  /** Marker file created after clone completes, used as baseline for modified file detection */
  CLONE_MARKER_FILE: "/tmp/.clone_complete",
  /** Claude hooks directory */
  CLAUDE_HOOKS_DIR: "/home/daytona/.claude/hooks",
  /** Claude settings file */
  CLAUDE_SETTINGS_FILE: "/home/daytona/.claude/settings.json",
  /** Agent session ID persistence file */
  AGENT_SESSION_FILE: "/home/daytona/.agent_session_id",
} as const

// =============================================================================
// Environment Variables
// =============================================================================

export const ENV_VARS = {
  /**
   * Environment variable for Claude Code credentials.
   * When set, the Agent SDK will automatically write this to ~/.claude/.credentials.json
   * Value should be the JSON content of the credentials file (e.g., {"claudeAiOauth":{"accessToken":"..."}})
   */
  CLAUDE_CODE_CREDENTIALS: "CLAUDE_CODE_CREDENTIALS",
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
// Timeouts
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
