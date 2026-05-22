/**
 * Hermes CLI Agent Definition
 *
 * Uses `hermes chat -q` for non-interactive single-turn execution.
 * Session continuity is achieved via `--resume <session_id>` on subsequent turns.
 *
 * Output protocol:
 *   stdout → plain response text (parsed as token events line-by-line)
 *   stderr → `session_id: <uuid>` at end of turn (extracted for session persistence)
 *
 * The bash wrapper prefixes all stderr lines with HERMES_STDERR: so the parser
 * can distinguish them without a separate file descriptor.
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent"
import type { Event } from "../../types/events"
import { parseHermesLine } from "./parser"
import { quote } from "../../utils/shell"

export const hermesAgent: AgentDefinition = {
  name: "hermes",

  // Hermes has no tool calling in its CLI output — it operates as a black box
  // that executes tools internally. We have no visibility into individual tool
  // calls from the CLI integration layer.
  toolMappings: {},

  capabilities: {
    supportsSystemPrompt: false,
    // Resume via `hermes chat --resume <session_id>`
    supportsResume: true,
    supportsPlanMode: false,
  },

  buildCommand(options: RunOptions): CommandSpec {
    // Build the hermes chat -q command.
    // -q      = single query (non-interactive)
    // -Q      = quiet: suppress banner/spinner/tool previews; emit "session_id: ..." to stderr
    // --yolo  = auto-approve shell commands (non-interactive context)
    // --ignore-rules = skip AGENTS.md / SOUL.md injection (our system prompt handles context)
    const parts: string[] = [
      "hermes",
      "chat",
      "-q", quote(options.prompt ?? ""),
      "-Q",
      "--yolo",
      "--ignore-rules",
    ]

    // Resume a previous session when a session ID is available.
    if (options.sessionId) {
      parts.push("--resume", quote(options.sessionId))
    }

    // Model selection: Hermes uses HERMES_INFERENCE_MODEL env var as the primary
    // mechanism, but also accepts --model on the chat subcommand.
    // We pass both for redundancy.
    if (options.model) {
      parts.push("--model", quote(options.model))
    }

    // Wrap in bash so we can:
    //   1. Prefix all stderr lines with HERMES_STDERR: (session ID extraction)
    //   2. Suppress any interactive terminal prompts that may escape -Q
    //
    // Pattern:
    //   { hermes ... 2>&3 ; } 3>&1 1>&1 | sed 's/^/HERMES_STDERR:/'
    //
    // Simpler equivalent using process substitution isn't POSIX-safe in all sh.
    // Instead we use a named-pipe approach with exec for clarity:
    //
    //   hermes ... 2> >(sed 's/^/HERMES_STDERR:/' >&1)
    //
    // This uses bash process substitution to redirect stderr through sed into
    // the merged stdout stream. Works in bash (which is what CommandSpec uses).
    const hermesCmd = parts.join(" ")
    // Prepend ~/.local/bin so hermes is found after `pip install --user`.
    // The nohup sh -c wrapper used by the sandbox strips PATH to a minimal set.
    // This is the same pattern goose uses.
    const command = `export PATH="$HOME/.local/bin:$PATH" && ${hermesCmd} 2> >(sed 's/^/HERMES_STDERR:/' >&1)`

    const env: Record<string, string> = {
      ...options.env,
      // Ensure non-interactive mode — prevents any auth prompts from blocking
      HERMES_QUIET: "1",
      // Auto-approve hooks in headless context
      HERMES_ACCEPT_HOOKS: "1",
    }

    // HERMES_INFERENCE_PROVIDER is injected by getEnvForModel when a credential
    // resolves — it tells Hermes which backend to route to. We forward it here
    // in case it wasn't already in options.env.
    if (options.env?.HERMES_INFERENCE_PROVIDER) {
      env.HERMES_INFERENCE_PROVIDER = options.env.HERMES_INFERENCE_PROVIDER
    }

    return {
      cmd: "bash",
      args: ["-c", command],
      env,
      wrapInBash: false, // Already wrapped above
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseHermesLine(line, context)
  },
}
