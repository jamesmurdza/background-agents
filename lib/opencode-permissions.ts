/**
 * OpenCode permissions configuration
 *
 * Sets up permission rules that block dangerous git operations.
 *
 * IMPORTANT: Permissions are enforced via the OPENCODE_PERMISSION env var, NOT the config file.
 *
 * Why we use an env var instead of the config file:
 * 1. The background-agents SDK sets OPENCODE_PERMISSION='{"*":"allow"}' by default
 *    in src/providers/opencode.ts to allow all actions in headless mode
 * 2. This env var takes precedence over the config file permissions
 * 3. Writing permissions to ~/.config/opencode/opencode.jsonc has no effect
 * 4. We must pass our permissions via OPENCODE_PERMISSION env var to override the SDK default
 * 5. The SDK merges env vars with `...options?.env` AFTER the default, so our value wins
 */

import fs from "fs"
import path from "path"

// Load permissions config from the hooks directory at module load time
const HOOKS_DIR = path.join(process.cwd(), "hooks")
const OPENCODE_PERMISSIONS = JSON.parse(
  fs.readFileSync(path.join(HOOKS_DIR, "opencode-permissions.json"), "utf-8")
)

/**
 * OpenCode permission rules as a JSON string for OPENCODE_PERMISSION env var.
 *
 * This is passed to the SDK via the `env` object in ensureSandboxReady(),
 * which overrides the SDK's default '{"*":"allow"}' that would bypass all permissions.
 *
 * The permissions block dangerous git operations:
 * - git commit --amend (history rewriting)
 * - git rebase (history rewriting)
 * - git reset --hard (history rewriting)
 * - git push (handled automatically by the platform)
 * - git branch -d/-D/-m/-M (branch manipulation)
 * - git checkout -b, git switch -c (branch creation)
 */
export const OPENCODE_PERMISSION_ENV = JSON.stringify(OPENCODE_PERMISSIONS.permission)
