/**
 * Git safety configuration for AI agents
 *
 * This module provides configuration and setup functions to block dangerous
 * git operations across different agent types (Claude, Codex, OpenCode).
 *
 * @example
 * ```ts
 * import { setupClaudeHooks, OPENCODE_PERMISSION_ENV } from '@background-agents/agent-policy/git'
 *
 * // For Claude Code
 * await setupClaudeHooks(sandbox)
 *
 * // For OpenCode
 * env: { OPENCODE_PERMISSION: OPENCODE_PERMISSION_ENV }
 *
 * // For Codex
 * await setupCodexRules(sandbox)
 * ```
 */

export {
  OPENCODE_PERMISSIONS,
  OPENCODE_PERMISSION_CONFIG,
  OPENCODE_PERMISSION_ENV,
} from "./opencode"

export {
  CODEX_RULES_DIR,
  CODEX_RULES_FILE,
  CODEX_RULES_CONTENT,
  setupCodexRules,
} from "./codex"

export {
  CLAUDE_HOOKS_DIR,
  CLAUDE_HOOK_FILE,
  CLAUDE_SETTINGS_FILE,
  CLAUDE_HOOK_CONTENT,
  CLAUDE_SETTINGS,
  setupClaudeHooks,
} from "./claude"
