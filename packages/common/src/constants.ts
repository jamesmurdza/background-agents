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
  /** Directory for user-uploaded files, kept separate from the repo clone */
  UPLOADS_DIR: "/home/daytona/uploads",
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
// Sandbox Configuration
// =============================================================================

export const SANDBOX_CONFIG = {
  /** Default snapshot for sandbox creation */
  DEFAULT_SNAPSHOT: "background-agents",
  /** Label key for identifying upstream-agents sandboxes */
  LABEL_KEY: "upstream-agents",
  /** Default preview port */
  DEFAULT_PREVIEW_PORT: 3000,
  /** Timeout in seconds for starting sandbox */
  START_TIMEOUT_SECONDS: 120,
} as const
