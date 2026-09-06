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

// =============================================================================
// Network baseline
// =============================================================================

/**
 * Domains always reachable from a sandbox, even in "restricted" network mode.
 *
 * Without these, restricting an environment breaks things the user never chose:
 * the git clone, the tokscale install at bring-up, and the agent CLI's own API
 * calls — all of which originate *inside* the sandbox. The environment editor
 * shows these as non-removable entries so the behavior is visible rather than
 * surprising.
 *
 * A user on a custom endpoint (User.customEndpoints) needs that host appended
 * at sandbox-creation time; see resolveDomainAllowList.
 */
export const BASELINE_DOMAINS = [
  // Source control
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  // Package registries
  "registry.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
  // Agent API hosts
  "api.anthropic.com",
  "console.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
  "opencode.ai",
  "server.smithery.ai",
  "registry.smithery.ai",
] as const
