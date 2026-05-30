/**
 * Shell command-string construction for background execution.
 *
 * Pure, sandbox-free helpers extracted from the background session so they can
 * be unit-tested in isolation.
 */

import type { CommandSpec } from "../core/agent"

/** Wrap a string in single quotes, escaping any embedded single quotes. */
export function quoteArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Build the full shell command string for a {@link CommandSpec}.
 *
 * Environment variables are inlined as a `KEY='value'` prefix so they reach the
 * spawned process regardless of how `executeBackground` handles the sandbox's
 * persistent env (`setEnvVars` may not be inherited). When `cwd` is set, a
 * `cd '<dir>' &&` prefix is prepended.
 */
export function buildFullCommand(
  spec: Pick<CommandSpec, "cmd" | "args" | "cwd" | "env">
): string {
  const quotedArgs = spec.args.map((arg) => quoteArg(arg))
  const command = [spec.cmd, ...quotedArgs].join(" ")

  const envPrefix = spec.env
    ? Object.entries(spec.env)
        .map(([k, v]) => `${k}=${quoteArg(v)}`)
        .join(" ") + " "
    : ""

  if (spec.cwd) {
    const safeCwd = spec.cwd.replace(/'/g, "'\\''")
    return `cd '${safeCwd}' && ${envPrefix}${command}`
  }
  return `${envPrefix}${command}`
}
