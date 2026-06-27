/**
 * Command-permission vocabulary.
 *
 * This is the input language of the translation layer: a rule is a command
 * prefix plus how to match its arguments. The per-agent renderers translate a
 * policy written in these terms into each coding agent's native config format
 * (Claude bash hook, Codex Starlark rules, OpenCode permission JSON). The
 * concrete ruleset (e.g. which git operations to block) is supplied by the
 * caller.
 */

/**
 * A single command-permission rule.
 *
 * Every rule denies some shape of a command identified by a leading token
 * `prefix` (e.g. `["git", "push"]`). The `kind` selects how arguments after the
 * prefix are matched. Each renderer maps these kinds onto its own format as
 * faithfully as that format allows — where a format can't express a nuance
 * (e.g. OpenCode globs can't model "deny unless --continue"), the renderer
 * falls back to denying the prefix wholesale.
 */
export type CommandRule =
  | {
      /** Deny the command outright whenever the prefix appears. */
      kind: "deny"
      prefix: string[]
      reason: string
    }
  | {
      /**
       * Deny only when one of `flags` appears anywhere in the command's
       * arguments (e.g. prefix `["git", "branch"]`, flags `["-d", "-D"]`).
       */
      kind: "deny-with-flag"
      prefix: string[]
      flags: string[]
      reason: string
    }
  | {
      /**
       * Deny the prefix unless the next token is one of `allow` (e.g. prefix
       * `["git", "rebase"]`, allow `["--continue", "--abort", "--skip"]`).
       */
      kind: "deny-except"
      prefix: string[]
      allow: string[]
      reason: string
    }
  | {
      /**
       * Deny when the prefix is followed by a name-like argument (a branch
       * ref). When `allowFileForms` is set, path/HEAD/`--` forms are still
       * permitted (used for `git checkout`, which doubles as a file operation).
       */
      kind: "deny-branch-arg"
      prefix: string[]
      allowFileForms?: boolean
      reason: string
    }

/** An ordered set of command rules to render into an agent's native format. */
export interface CommandPolicy {
  deny: CommandRule[]
}
