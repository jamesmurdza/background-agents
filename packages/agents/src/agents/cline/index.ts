/**
 * Cline CLI Agent Definition
 *
 * Cline is a CLI-based AI coding agent that supports multiple providers
 * including Anthropic, OpenAI, and others.
 *
 * @see https://docs.cline.bot/cline-cli/getting-started
 */

import type {
  AgentDefinition,
  CommandSpec,
  ParseContext,
  RunOptions,
} from "../../core/agent.js"
import type { Event } from "../../types/events.js"
import type { CodeAgentSandbox } from "../../types/provider.js"
import { parseClineLine } from "./parser.js"
import { CLINE_TOOL_MAPPINGS } from "./tools.js"

/**
 * Cline agent-specific setup: authenticate with API key using cline auth command.
 *
 * Cline CLI stores credentials after running `cline auth`. We run this before
 * the main command to configure authentication non-interactively.
 *
 * IMPORTANT: The cline auth command requires all three flags (-p, -k, -m) to
 * avoid interactive prompts. Without -m, it shows an interactive menu.
 */
async function clineSetup(
  sandbox: CodeAgentSandbox,
  env: Record<string, string>
): Promise<void> {
  if (!sandbox.executeCommand) return

  // Determine provider, API key, and default model from environment
  let provider: string | undefined
  let apiKey: string | undefined
  let defaultModel: string

  if (env.ANTHROPIC_API_KEY) {
    provider = "anthropic"
    apiKey = env.ANTHROPIC_API_KEY
    defaultModel = "claude-sonnet-4-5-20250929"
  } else if (env.OPENAI_API_KEY) {
    provider = "openai-native"
    apiKey = env.OPENAI_API_KEY
    defaultModel = "gpt-4o"
  } else {
    return // No recognized API key
  }

  // Run cline auth with all three flags (-p, -k, -m) to configure credentials
  // non-interactively. All three are required to avoid interactive prompts.
  const safeKey = apiKey.replace(/'/g, "'\\''")
  await sandbox.executeCommand(
    `cline auth -p '${provider}' -k '${safeKey}' -m '${defaultModel}' 2>&1 || true`,
    30
  )
}

/**
 * Cline CLI agent definition.
 *
 * Interacts with the Cline CLI tool which outputs JSON lines
 * when run with the --json flag.
 */
export const clineAgent: AgentDefinition = {
  name: "cline",

  toolMappings: CLINE_TOOL_MAPPINGS,

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: false, // Session resume TBD based on CLI capabilities
    setup: clineSetup,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args: string[] = []

    // Auto-approve all actions for headless/autonomous operation
    // -y / --yolo flag enables autonomous execution
    args.push("-y")

    // JSON output for streaming events
    args.push("--json")

    // Add model if specified
    // Cline supports -m / --model for model selection
    if (options.model) {
      args.push("-m", options.model)
    }

    // Add timeout if specified
    if (options.timeout) {
      args.push("--timeout", String(options.timeout))
    }

    // Add prompt as trailing argument
    if (options.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "cline",
      args,
      env: options.env,
    }
  },

  parse(line: string, context: ParseContext): Event | Event[] | null {
    return parseClineLine(line, this.toolMappings, context)
  },
}
