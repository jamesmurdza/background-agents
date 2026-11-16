/**
 * Give the user's app its own env vars back inside the agent's shell commands.
 *
 * A caller that shares env var names with the agent CLI (e.g. the user's app
 * reads ANTHROPIC_API_KEY, and so does Claude Code) passes the user's value
 * renamed with a trailing underscore (`ANTHROPIC_API_KEY_`), and lists the
 * original names in {@link APP_ENV_REMAP_ENV}. The CLI never sees the user's
 * value under the name it reads, so it keeps using the caller's credential.
 *
 * The shell commands the CLI runs (`npm run dev`, ...) should see the user's
 * value under its real name, though. A small sourced script does that:
 *
 *   - non-login `bash -c` sources it via BASH_ENV;
 *   - login `bash -lc` (e.g. Codex's shell tool) sources it via ~/.profile;
 *   - `bash -c` whose stdin is a socket (e.g. Kimi's shell tool) sources it
 *     via ~/.bashrc: bash then assumes it was started by sshd and runs only
 *     ~/.bashrc, never BASH_ENV. The line goes at the top, before the usual
 *     early return for non-interactive shells;
 *   - Claude Code's Bash tool, which ignores BASH_ENV, via CLAUDE_ENV_FILE.
 *
 * Neither may run for the CLI process itself, or the CLI would get the user's
 * value back. So the script only acts when {@link APP_ENV_ARMED_ENV} is set,
 * and that (with BASH_ENV) is set only on the CLI process (see
 * {@link applyAppEnvHook}): never on the job launcher, and for agents launched
 * through a `bash -c` wrapper, only after the wrapper shell has started, so
 * the wrapper's own startup never maps anything.
 */

import type { CommandSpec } from "../core/agent"
import type { CodeAgentSandbox } from "../types/provider"

/** Space-separated names whose `NAME_` twin should be mapped back to `NAME`. */
export const APP_ENV_REMAP_ENV = "BG_APP_ENV_REMAP"
/** Set only on the agent CLI process; the hook script is a no-op without it. */
export const APP_ENV_ARMED_ENV = "BG_APP_ENV_ARMED"
/** The hook script. Static: names come from the env, it never holds a value. */
export const APP_ENV_HOOK_FILE = "/home/daytona/.backgrounder-app-env.sh"
/** Sourced by login shells; the hook line is appended. */
const PROFILE_FILE = "/home/daytona/.profile"
/** Sourced by sshd-style `bash -c`; the hook line must come first. */
const BASHRC_FILE = "/home/daytona/.bashrc"

/**
 * POSIX sh, since ~/.profile may also be read by a login `sh`. Names are
 * checked before the eval, so a malformed list can't run anything.
 */
export const APP_ENV_HOOK_SCRIPT = `# Backgrounder: map the user's renamed env vars back for the agent's shell commands.
if [ -n "\${${APP_ENV_ARMED_ENV}:-}" ]; then
  for __bg_name in \${${APP_ENV_REMAP_ENV}:-}; do
    case "$__bg_name" in ""|[0-9]*|*[!A-Za-z0-9_]*) continue ;; esac
    if eval "[ -n \\"\\\${\${__bg_name}_+x}\\" ]"; then eval "export \${__bg_name}=\\"\\\${\${__bg_name}_}\\""; fi
  done
  unset __bg_name
fi
`

const PROFILE_LINE = `[ -f ${APP_ENV_HOOK_FILE} ] && . ${APP_ENV_HOOK_FILE}`

/** Whether `env` asks for any names to be mapped back. */
export function wantsAppEnvHook(env: Record<string, string> | undefined): boolean {
  return !!env?.[APP_ENV_REMAP_ENV]?.trim()
}

/**
 * Write the hook script and source it from ~/.profile (appended) and
 * ~/.bashrc (prepended), once each. Idempotent. The script holds no values
 * and does nothing unless armed, so the user's own terminal shells are
 * unaffected.
 */
export async function installAppEnvHook(sandbox: CodeAgentSandbox): Promise<void> {
  if (!sandbox.executeCommand) return
  const script = Buffer.from(APP_ENV_HOOK_SCRIPT).toString("base64")
  const has = (file: string) => `grep -qxF '${PROFILE_LINE}' '${file}' 2>/dev/null`
  const result = await sandbox.executeCommand(
    `echo '${script}' | base64 -d > '${APP_ENV_HOOK_FILE}' && ` +
      `{ ${has(PROFILE_FILE)} || echo '${PROFILE_LINE}' >> '${PROFILE_FILE}'; } && ` +
      `{ ${has(BASHRC_FILE)} || { { echo '${PROFILE_LINE}'; cat '${BASHRC_FILE}' 2>/dev/null; } > '${BASHRC_FILE}.bg-tmp' && mv '${BASHRC_FILE}.bg-tmp' '${BASHRC_FILE}'; }; }`,
    15
  )
  if (result.exitCode !== 0) throw new Error("Failed to install the app env hook")
}

/** A `bash -c`/`bash -lc` wrapper script: [flag, script]. */
function wrapperScriptIndex(spec: CommandSpec): number | undefined {
  if (spec.cmd !== "bash" && spec.cmd !== "sh") return undefined
  const flagIndex = spec.args.findIndex((a) => /^-l?c$|^-cl$/.test(a))
  return flagIndex >= 0 && flagIndex + 1 < spec.args.length ? flagIndex + 1 : undefined
}

/**
 * Arm the hook for the CLI process in `spec`, when `env` asks for it.
 *
 * A plain CLI gets BASH_ENV and the armed flag in its env. The job launcher
 * runs it through `sh -c`, which reads neither BASH_ENV nor ~/.profile.
 *
 * An agent wrapped in `bash -c '... cli ...'` must not get them in its env:
 * the wrapper shell would source the hook at startup, armed, and hand the
 * user's values to the CLI. They are exported inside the script instead,
 * which runs after the wrapper's startup files.
 */
export function applyAppEnvHook(spec: CommandSpec, env: Record<string, string> | undefined): CommandSpec {
  if (!wantsAppEnvHook(env)) return spec
  const scriptIndex = wrapperScriptIndex(spec)
  if (scriptIndex === undefined) {
    return { ...spec, env: { ...spec.env, ...HOOK_VARS } }
  }
  const args = [...spec.args]
  const exports = Object.entries(HOOK_VARS).map(([k, v]) => `${k}='${v}'`).join(" ")
  args[scriptIndex] = `export ${exports}\n${args[scriptIndex]}`
  return { ...spec, args }
}

/**
 * What arms the hook for the CLI's shells. Claude Code's Bash tool doesn't
 * honour BASH_ENV, but sources CLAUDE_ENV_FILE before every command (never
 * for the CLI itself); other CLIs ignore that variable.
 */
const HOOK_VARS: Record<string, string> = {
  BASH_ENV: APP_ENV_HOOK_FILE,
  CLAUDE_ENV_FILE: APP_ENV_HOOK_FILE,
  [APP_ENV_ARMED_ENV]: "1",
}
