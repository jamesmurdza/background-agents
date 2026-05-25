/**
 * OpenCode permissions configuration
 *
 * OpenCode uses a JSON-based permission system passed via the OPENCODE_PERMISSION
 * environment variable. This takes precedence over any config file settings.
 *
 * Permission format:
 * - Keys are command patterns with wildcards (*)
 * - Values are "allow" or "deny"
 * - More specific patterns take precedence
 */

/**
 * OpenCode permission rules.
 *
 * `bash` rules block dangerous git operations:
 * - git commit --amend (history rewriting)
 * - git rebase (history rewriting)
 * - git reset --hard (history rewriting)
 * - git push (handled automatically by the platform)
 * - git branch -d/-D/-m/-M (branch manipulation)
 * - git checkout (use "git restore" for file operations)
 * - git switch (branch switching)
 *
 * `edit` and `webfetch` are explicitly allowed. Without these, opencode falls
 * back to its built-in default ("ask"), which in headless/scheduled mode
 * becomes an auto-rejection — see the `external_directory` denial that crashes
 * scheduled runs the first time the agent (or opencode itself) touches
 * `/tmp/logs/*`. `webfetch` is opened up so MCP servers and the agent's own
 * web tooling work in scheduled jobs.
 */
export const OPENCODE_PERMISSIONS = {
  bash: {
    "*": "allow",
    "git commit --amend*": "deny",
    "git commit * --amend*": "deny",
    "git rebase*": "deny",
    "git reset --hard*": "deny",
    "git reset * --hard*": "deny",
    "git push*": "deny",
    "git branch -d*": "deny",
    "git branch -D*": "deny",
    "git branch * -d*": "deny",
    "git branch * -D*": "deny",
    "git branch -m*": "deny",
    "git branch -M*": "deny",
    "git branch * -m*": "deny",
    "git branch * -M*": "deny",
    "git checkout*": "deny",
    "git switch*": "deny",
  },
  edit: {
    "*": "allow",
  },
  webfetch: {
    "*": "allow",
  },
} as const

/**
 * Full permission object structure expected by OpenCode.
 */
export const OPENCODE_PERMISSION_CONFIG = {
  permission: OPENCODE_PERMISSIONS,
} as const

/**
 * JSON string for the OPENCODE_PERMISSION environment variable.
 *
 * Use this value directly when setting up the agent environment:
 * ```ts
 * env: {
 *   OPENCODE_PERMISSION: OPENCODE_PERMISSION_ENV,
 * }
 * ```
 */
export const OPENCODE_PERMISSION_ENV = JSON.stringify(OPENCODE_PERMISSIONS)
