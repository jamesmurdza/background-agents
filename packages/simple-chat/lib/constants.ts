/**
 * Constants for Simple Chat
 */

export const PATHS = {
  /** Base directory for repo clones in sandbox */
  SANDBOX_HOME: "/home/daytona",
  /** Directory for agent log files */
  LOGS_DIR: "/tmp/logs",
  /** Claude credentials directory */
  CLAUDE_CREDENTIALS_DIR: "/home/daytona/.claude",
} as const

export const SANDBOX_CONFIG = {
  /** Default snapshot for sandbox creation */
  DEFAULT_SNAPSHOT: "daytona-medium",
  /** Label key for identifying simple-chat sandboxes */
  LABEL_KEY: "simple-chat",
  /** Default preview port */
  DEFAULT_PREVIEW_PORT: 3000,
} as const
