/**
 * Git safety policy for background agents.
 *
 * This is the *content* side of the agent-configuration translation layer: it
 * declares which git operations agents are not allowed to run. The
 * `@background-agents/agent-configuration` package knows nothing about git — it
 * only knows how to render a `CommandPolicy` into each agent's native config
 * format. This file owns the actual rules; the translation layer applies them.
 *
 * Blocked, and why:
 * - history rewriting: `git commit --amend`, `git rebase`, `git reset --hard`
 * - `git push` — pushing is handled automatically by the platform
 * - branch manipulation: delete (`-d/-D`), rename (`-m/-M`), create (`-b`/`-c`)
 * - branch switching: `git checkout <branch>` / `git switch <branch>`
 *
 * `git rebase --continue/--abort/--skip` stays allowed so agents can resolve
 * conflicts. For `git checkout`, file-level forms (`.`, `-- <file>`, `HEAD`)
 * stay allowed since checkout doubles as a file operation; agents are otherwise
 * told to use `git restore`.
 */

import type { CommandPolicy } from "@background-agents/agent-configuration/permissions"

export const DEFAULT_GIT_POLICY: CommandPolicy = {
  deny: [
    {
      kind: "deny-with-flag",
      prefix: ["git", "commit"],
      flags: ["--amend"],
      reason: "git commit --amend rewrites history. Create a new commit instead.",
    },
    {
      kind: "deny-except",
      prefix: ["git", "rebase"],
      allow: ["--continue", "--abort", "--skip"],
      reason: "git rebase rewrites history and is not allowed.",
    },
    {
      kind: "deny-with-flag",
      prefix: ["git", "reset"],
      flags: ["--hard"],
      reason: "git reset --hard discards commits and is not allowed.",
    },
    {
      kind: "deny",
      prefix: ["git", "push"],
      reason: "git push is not allowed. Pushing is handled automatically.",
    },
    {
      kind: "deny-with-flag",
      prefix: ["git", "branch"],
      flags: ["-d", "-D"],
      reason: "Deleting branches is not allowed.",
    },
    {
      kind: "deny-with-flag",
      prefix: ["git", "branch"],
      flags: ["-m", "-M"],
      reason: "Renaming branches is not allowed.",
    },
    {
      kind: "deny-with-flag",
      prefix: ["git", "checkout"],
      flags: ["-b"],
      reason: "Creating branches is not allowed. Stay on the current branch.",
    },
    {
      kind: "deny-with-flag",
      prefix: ["git", "switch"],
      flags: ["-c"],
      reason: "Creating branches is not allowed. Stay on the current branch.",
    },
    {
      kind: "deny-branch-arg",
      prefix: ["git", "switch"],
      reason: "Switching branches is not allowed. Stay on the current branch.",
    },
    {
      kind: "deny-branch-arg",
      prefix: ["git", "checkout"],
      allowFileForms: true,
      reason:
        "Switching branches is not allowed. Use 'git restore' to discard file changes.",
    },
  ],
}
