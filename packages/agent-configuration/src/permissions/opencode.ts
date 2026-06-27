/**
 * OpenCode permission renderer.
 *
 * OpenCode reads a JSON permission map from the OPENCODE_PERMISSION environment
 * variable, which takes precedence over config files. Keys are glob-style
 * command patterns; values are "allow" or "deny", most-specific-wins. This
 * module renders a `CommandPolicy` into the `bash` section and merges it with
 * the baseline permissions the agent needs to run headlessly.
 */

import type { CommandPolicy, CommandRule } from "./types"

/**
 * Baseline permissions unrelated to the command policy: these enable the agent
 * to function in headless/scheduled mode. Without them OpenCode falls back to
 * its built-in "ask", which auto-rejects when no user is present. `edit` lets
 * the agent modify files, `webfetch` keeps MCP/web tooling working, and
 * `external_directory` allows reading user-uploaded files.
 */
export const OPENCODE_BASELINE_PERMISSIONS = {
  edit: { "*": "allow" },
  webfetch: { "*": "allow" },
  external_directory: { "*": "allow" },
} as const

/** The deny glob(s) a single rule expands to in OpenCode. */
function ruleGlobs(rule: CommandRule): string[] {
  const prefix = rule.prefix.join(" ")
  switch (rule.kind) {
    case "deny":
    case "deny-except":
    case "deny-branch-arg":
      // Globs can't model exceptions or branch-arg nuance: deny the prefix.
      return [`${prefix}*`]
    case "deny-with-flag":
      // Match the flag immediately after the prefix or later in the args.
      return rule.flags.flatMap((flag) => [
        `${prefix} ${flag}*`,
        `${prefix} * ${flag}*`,
      ])
  }
}

/** Render a `CommandPolicy` into OpenCode's full permission object. */
export function renderOpenCodePermissions(policy: CommandPolicy) {
  const bash: Record<string, "allow" | "deny"> = { "*": "allow" }
  for (const rule of policy.deny) {
    for (const glob of ruleGlobs(rule)) {
      bash[glob] = "deny"
    }
  }
  return { bash, ...OPENCODE_BASELINE_PERMISSIONS }
}

/**
 * Render the JSON string for the OPENCODE_PERMISSION environment variable.
 *
 * ```ts
 * env: { OPENCODE_PERMISSION: renderOpenCodePermissionEnv(policy) }
 * ```
 */
export function renderOpenCodePermissionEnv(policy: CommandPolicy): string {
  return JSON.stringify(renderOpenCodePermissions(policy))
}
