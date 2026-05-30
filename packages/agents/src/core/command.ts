/**
 * Declarative command builder shared by all CLI agents.
 *
 * Every agent's `buildCommand` historically repeated the same scaffolding:
 * push a subcommand, push static flags, branch on plan mode, append the model,
 * append a resume flag, then append the prompt (often behind a `--` sentinel).
 * The only things that varied were the exact flag names, the prompt style, and
 * whether the result was wrapped in `bash`.
 *
 * `buildAgentCommand` captures that shape as data so each agent only declares
 * an {@link AgentCommandConfig}. The emitted argument order is fixed and
 * documented below so the behaviour is identical to the hand-written builders.
 */

import type { CommandSpec, RunOptions } from "./agent"
import { quote } from "../utils/shell"

/**
 * How the user prompt is passed to the CLI.
 * - `sentinel`: appended after a literal `--` end-of-options marker.
 * - `flag`: appended after the given flag (e.g. `-p` or `--text`).
 */
export type PromptStyle =
  | { kind: "sentinel" }
  | { kind: "flag"; flag: string }

/** Plan-mode handling: either swap in different flags, or prefix the prompt. */
export interface PlanModeConfig {
  /** Flags added when `planMode` is true. */
  flags?: string[]
  /** Flags added when `planMode` is false. */
  defaultFlags?: string[]
  /**
   * When set, plan mode prepends this string to the prompt (e.g. `"/plan "`)
   * instead of adding flags. Mutually exclusive with `flags`/`defaultFlags`.
   */
  promptPrefix?: string
}

/** Model flag handling, optionally with a derived provider flag (goose). */
export interface ModelConfig {
  /** Flag carrying the model value, e.g. `--model` or `-m`. */
  flag: string
  /** Optional separate provider flag emitted before the model, e.g. `--provider`. */
  providerFlag?: string
  /** Derives the provider value from the model name. Requires `providerFlag`. */
  deriveProvider?: (model: string) => string
}

/** Session-resume flag handling. */
export interface ResumeConfig {
  /** Resume flag, e.g. `--resume`, `--continue`, `-s`, or `resume`. */
  flag: string
  /** Whether the flag is followed by the session id (default false). */
  takesValue?: boolean
}

/** Wrap the final command in a bash invocation (for PATH/stderr handling). */
export interface BashWrapConfig {
  /** Shell flags, e.g. `["-lc"]` or `["-c"]`. */
  shellArgs: string[]
  /** String prepended inside the shell command (e.g. a PATH export). */
  prefix?: string
  /** Append `2>&1` to redirect stderr into stdout. */
  redirectStderr?: boolean
}

/**
 * Declarative description of a CLI agent's command line.
 *
 * Arguments are emitted in this fixed order:
 *   1. prompt (only when `prompt.position === "first"`)
 *   2. subcommand
 *   3. baseFlags
 *   4. plan-mode flags (unless plan mode uses a prompt prefix)
 *   5. system prompt (unless `systemPromptAfterPrompt`)
 *   6. provider + model
 *   7. resume
 *   8. prompt (when `prompt.position` is `"last"`/omitted)
 *   9. system prompt (when `systemPromptAfterPrompt`)
 */
export interface AgentCommandConfig {
  /** The binary to invoke (also the command name unless bash-wrapped). */
  bin: string
  /** Leading subcommand tokens, e.g. `["exec"]` or `["run"]`. */
  subcommand?: string[]
  /** Static flags always present, in order. */
  baseFlags?: string[]
  /** Plan-mode handling. */
  planMode?: PlanModeConfig
  /** Native system-prompt flag, e.g. `--system-prompt` or `--system`. */
  systemPromptFlag?: string
  /** Emit the system prompt after the prompt rather than before the model. */
  systemPromptAfterPrompt?: boolean
  /** Model flag handling. */
  model?: ModelConfig
  /** Resume flag handling. */
  resume?: ResumeConfig
  /** Prompt handling. Defaults to `position: "last"` when omitted. */
  prompt?: { style: PromptStyle; position?: "first" | "last" }
  /** Wrap the command in bash (single-quotes every token). */
  bashWrap?: BashWrapConfig
  /** Default env merged under (overridable by) `options.env`. */
  defaultEnv?: Record<string, string>
}

/**
 * Build a {@link CommandSpec} from a declarative {@link AgentCommandConfig}.
 */
export function buildAgentCommand(
  config: AgentCommandConfig,
  options: RunOptions
): CommandSpec {
  const args: string[] = []
  const position = config.prompt?.position ?? "last"

  const emitPrompt = () => {
    if (!options.prompt || !config.prompt) return
    let prompt = options.prompt
    if (options.planMode && config.planMode?.promptPrefix) {
      prompt = `${config.planMode.promptPrefix}${prompt}`
    }
    const style = config.prompt.style
    if (style.kind === "sentinel") {
      // The "--" sentinel signals end-of-options so prompts beginning with
      // "-" are not mis-parsed as flags by the CLI's argument parser.
      args.push("--", prompt)
    } else {
      args.push(style.flag, prompt)
    }
  }

  const emitSystemPrompt = () => {
    if (config.systemPromptFlag && options.systemPrompt) {
      args.push(config.systemPromptFlag, options.systemPrompt)
    }
  }

  if (position === "first") emitPrompt()

  if (config.subcommand) args.push(...config.subcommand)
  if (config.baseFlags) args.push(...config.baseFlags)

  if (config.planMode && config.planMode.promptPrefix === undefined) {
    const planFlags = options.planMode
      ? config.planMode.flags
      : config.planMode.defaultFlags
    if (planFlags) args.push(...planFlags)
  }

  if (!config.systemPromptAfterPrompt) emitSystemPrompt()

  if (config.model && options.model) {
    if (config.model.providerFlag && config.model.deriveProvider) {
      args.push(config.model.providerFlag, config.model.deriveProvider(options.model))
    }
    args.push(config.model.flag, options.model)
  }

  if (config.resume && options.sessionId) {
    if (config.resume.takesValue) {
      args.push(config.resume.flag, options.sessionId)
    } else {
      args.push(config.resume.flag)
    }
  }

  if (position === "last") emitPrompt()
  if (config.systemPromptAfterPrompt) emitSystemPrompt()

  const env = config.defaultEnv
    ? { ...config.defaultEnv, ...options.env }
    : options.env

  if (config.bashWrap) {
    const command =
      (config.bashWrap.prefix ?? "") +
      [config.bin, ...args].map(quote).join(" ") +
      (config.bashWrap.redirectStderr ? " 2>&1" : "")
    return {
      cmd: "bash",
      args: [...config.bashWrap.shellArgs, command],
      env,
      wrapInBash: false,
    }
  }

  return { cmd: config.bin, args, env }
}
