/**
 * @upstream/agent-configuration
 *
 * Agent configuration and policy rules for blocking dangerous operations.
 *
 * This package provides centralized configuration for AI coding agents,
 * including git safety rules that prevent history rewriting, unauthorized
 * pushes, and branch manipulation.
 *
 * @example
 * ```ts
 * import {
 *   setupClaudeHooks,
 *   setupCodexRules,
 *   OPENCODE_PERMISSION_ENV,
 * } from '@upstream/agent-configuration'
 *
 * // Setup for Claude Code agent
 * await setupClaudeHooks(sandbox)
 *
 * // Setup for Codex agent
 * await setupCodexRules(sandbox)
 *
 * // Setup for OpenCode agent (via environment variable)
 * const env = { OPENCODE_PERMISSION: OPENCODE_PERMISSION_ENV }
 * ```
 */

// Re-export all git safety configuration
export * from "./git"
