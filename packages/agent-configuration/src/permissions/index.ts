/**
 * Command-permission translation layer.
 *
 * Renders an agent-agnostic `CommandPolicy` into each coding agent's native
 * permission format and installs it into the sandbox. The policy *content*
 * (which commands to deny) is supplied by the caller — this layer only
 * translates.
 *
 * @example
 * ```ts
 * import {
 *   setupClaudePermissions,
 *   setupCodexPermissions,
 *   renderOpenCodePermissionEnv,
 *   type CommandPolicy,
 * } from '@background-agents/agent-configuration/permissions'
 *
 * await setupClaudePermissions(sandbox, policy)   // Claude Code
 * await setupCodexPermissions(sandbox, policy)    // Codex
 * env.OPENCODE_PERMISSION = renderOpenCodePermissionEnv(policy) // OpenCode
 * ```
 */

export type { CommandPolicy, CommandRule } from "./types"

export {
  CLAUDE_HOOKS_DIR,
  CLAUDE_HOOK_FILE,
  CLAUDE_SETTINGS_FILE,
  CLAUDE_SETTINGS,
  renderClaudeHook,
  setupClaudePermissions,
} from "./claude"

export {
  CODEX_RULES_DIR,
  CODEX_RULES_FILE,
  renderCodexRules,
  setupCodexPermissions,
} from "./codex"

export {
  OPENCODE_BASELINE_PERMISSIONS,
  renderOpenCodePermissions,
  renderOpenCodePermissionEnv,
} from "./opencode"
