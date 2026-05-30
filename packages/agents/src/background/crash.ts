/**
 * Crash-event synthesis for background sessions.
 *
 * When a background agent process exits without emitting a terminal `end`
 * event, we synthesise an {@link AgentCrashedEvent} from whatever non-JSON
 * output it left behind (typically stderr). Pure and sandbox-free.
 */

import type { AgentCrashedEvent } from "../types/events"

/** Extract the non-JSON (human-readable) lines from raw agent output. */
function nonJsonOutput(rawOutput: string): string {
  const trimmed = rawOutput.trim()
  const nonJsonLines = trimmed.split("\n").filter((l) => {
    const t = l.trim()
    return t && !(t.startsWith("{") && t.endsWith("}"))
  })
  return nonJsonLines.join("\n").trim()
}

/**
 * Build an {@link AgentCrashedEvent} describing why a process exited without
 * completing. Recognises a few actionable failure modes (e.g. an unavailable
 * Copilot model) and otherwise falls back to a generic crash message carrying
 * the tail of the non-JSON output.
 */
export function synthesizeCrashEvent(rawOutput: string): AgentCrashedEvent {
  const output = nonJsonOutput(rawOutput)

  // ── Model not available ─────────────────────────────────────────────────
  // The Copilot CLI writes this to stderr (non-JSON) when the --model flag
  // names a model the account can't access:
  //   Error: Model "claude-sonnet-4.5" from --model flag is not available.
  const modelNotAvailableMatch = output.match(
    /Model\s+"([^"]+)"\s+(?:from --model flag\s+)?is not available/i
  )
  if (modelNotAvailableMatch) {
    return {
      type: "agent_crashed",
      message:
        `Model "${modelNotAvailableMatch[1]}" is not available on your GitHub Copilot plan. ` +
        `Select a different model (e.g. gpt-5-mini, gpt-4o, claude-haiku-4.5).`,
    }
  }

  // ── Generic crash fallback ──────────────────────────────────────────────
  return {
    type: "agent_crashed",
    message: "Agent process exited without completing (crashed or killed)",
    output: output.slice(-4096) || undefined,
  }
}
