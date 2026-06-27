/**
 * Codex rules configuration
 *
 * Codex uses Starlark-based rules stored in ~/.codex/rules/default.rules.
 * These rules are evaluated before command execution to allow/deny operations.
 */

import type { Sandbox } from "@daytonaio/sdk"

/** Codex rules directory path in the sandbox */
export const CODEX_RULES_DIR = "/home/daytona/.codex/rules"

/** Codex rules file path */
export const CODEX_RULES_FILE = `${CODEX_RULES_DIR}/default.rules`

/**
 * Starlark rules content that blocks dangerous git operations.
 *
 * Rules block:
 * - git commit --amend (history rewriting)
 * - git rebase (history rewriting)
 * - git reset --hard (history rewriting)
 * - git push (handled automatically)
 * - git branch -d/-D (branch deletion)
 * - git branch -m/-M (branch renaming)
 * - git checkout (use "git restore" for file operations)
 * - git switch (branch switching)
 */
export const CODEX_RULES_CONTENT = `# Codex rules to prevent dangerous git operations
# These rules block commands that rewrite history, push, or manipulate branches
#
# Note: git checkout and git switch are blocked entirely.
# The system prompt tells agents to use "git restore" for file operations.

# Block git commit --amend (history rewriting)
prefix_rule(
    pattern=["git", "commit", "--amend"],
    decision="forbidden",
    justification="git commit --amend rewrites history. Create a new commit instead.",
)

prefix_rule(
    pattern=["git", "commit", "-a", "--amend"],
    decision="forbidden",
    justification="git commit --amend rewrites history. Create a new commit instead.",
)

# Block git rebase (history rewriting)
prefix_rule(
    pattern=["git", "rebase"],
    decision="forbidden",
    justification="git rebase rewrites history and is not allowed.",
)

# Block git reset --hard (history rewriting)
prefix_rule(
    pattern=["git", "reset", "--hard"],
    decision="forbidden",
    justification="git reset --hard rewrites history and is not allowed.",
)

# Block git push (handled automatically)
prefix_rule(
    pattern=["git", "push"],
    decision="forbidden",
    justification="git push is not allowed. Pushing is handled automatically.",
)

# Block git branch -d/-D (branch deletion)
prefix_rule(
    pattern=["git", "branch", "-d"],
    decision="forbidden",
    justification="Deleting branches is not allowed.",
)

prefix_rule(
    pattern=["git", "branch", "-D"],
    decision="forbidden",
    justification="Deleting branches is not allowed.",
)

# Block git branch -m/-M (branch renaming)
prefix_rule(
    pattern=["git", "branch", "-m"],
    decision="forbidden",
    justification="Renaming branches is not allowed.",
)

prefix_rule(
    pattern=["git", "branch", "-M"],
    decision="forbidden",
    justification="Renaming branches is not allowed.",
)

# Block git checkout entirely (use "git restore" for file operations)
prefix_rule(
    pattern=["git", "checkout"],
    decision="forbidden",
    justification="git checkout is not allowed. Use 'git restore' to discard file changes.",
)

# Block git switch entirely
prefix_rule(
    pattern=["git", "switch"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)
`

/**
 * Sets up Codex rules in a Daytona sandbox.
 *
 * This uploads the Starlark rules file that blocks dangerous git operations.
 * Should be called during agent session setup.
 *
 * @param sandbox - The Daytona sandbox instance
 */
export async function setupCodexRules(sandbox: Sandbox): Promise<void> {
  // Create the rules directory
  await sandbox.process.executeCommand(`mkdir -p ${CODEX_RULES_DIR}`)

  // Upload the rules file
  await sandbox.fs.uploadFile(
    Buffer.from(CODEX_RULES_CONTENT, "utf-8"),
    CODEX_RULES_FILE
  )

  // Set proper permissions
  await sandbox.process.executeCommand(`chmod 600 ${CODEX_RULES_FILE}`)
}
