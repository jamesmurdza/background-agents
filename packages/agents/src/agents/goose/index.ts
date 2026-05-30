/**
 * Goose CLI Agent Definition
 */

import type { AgentDefinition, CommandSpec, ParseContext, RunOptions } from "../../core/agent"
import type { Event } from "../../types/events"
import { buildAgentCommand } from "../../core/command"
import { parseGooseLine } from "./parser"
import { GOOSE_TOOL_MAPPINGS } from "./tools"

/**
 * Determine the goose provider based on the given model name.
 * Goose supports multiple providers: openai, anthropic, ollama, etc.
 */
function getGooseProvider(model: string): string {
  // If model contains "claude", use anthropic provider
  if (model.toLowerCase().includes("claude")) {
    return "anthropic"
  }

  // Default to OpenAI provider
  return "openai"
}

/**
 * Goose CLI agent definition.
 *
 * Interacts with the Goose CLI tool (Block's open source AI coding agent).
 */
export const gooseAgent: AgentDefinition = {
  name: "goose",

  toolMappings: GOOSE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: true,
    supportsResume: true,
    supportsPlanMode: true,
  },

  buildCommand(options: RunOptions): CommandSpec {
    return buildAgentCommand(
      {
        bin: "goose",
        // run = non-interactive; stream-json = machine-readable events.
        subcommand: ["run"],
        baseFlags: ["--output-format", "stream-json"],
        // Plan mode prepends "/plan " to the prompt rather than adding a flag.
        planMode: { promptPrefix: "/plan " },
        // Goose pairs a derived provider with the model flag.
        model: {
          flag: "--model",
          providerFlag: "--provider",
          deriveProvider: getGooseProvider,
        },
        // Goose resumes the most recent session when --resume is passed.
        resume: { flag: "--resume" },
        // Prompt is text input; system prompt follows it via --system.
        prompt: { style: { kind: "flag", flag: "--text" } },
        systemPromptFlag: "--system",
        systemPromptAfterPrompt: true,
        // Wrap in bash so PATH includes ~/.local/bin where goose installs.
        bashWrap: {
          shellArgs: ["-c"],
          prefix: `export PATH="$HOME/.local/bin:$PATH" && `,
        },
      },
      options
    )
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseGooseLine(line, this.toolMappings, context)
  },
}
