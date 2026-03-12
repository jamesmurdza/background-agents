#!/usr/bin/env npx tsx
/**
 * Interactive REPL for testing the Code Agent SDK
 *
 * Usage: npx tsx scripts/repl.ts [--provider <name>] [--model <model>]
 *
 * Supported providers: claude, codex, opencode, gemini
 *
 * Required environment variables:
 *   DAYTONA_API_KEY - Required for all providers
 *   ANTHROPIC_API_KEY - Required for claude provider
 *   OPENAI_API_KEY - Required for codex provider
 *   GEMINI_API_KEY - Required for gemini provider
 *   OPENCODE_API_KEY - Required for opencode provider (or provider-specific key)
 */
import * as readline from "node:readline"
import { Daytona } from "@daytonaio/sdk"
import { createProvider, getProviderNames, isValidProvider, type ProviderName } from "../src/index.js"

// Provider -> API key environment variable mapping
const PROVIDER_API_KEYS: Record<ProviderName, { envVar: string; name: string }> = {
  claude: { envVar: "ANTHROPIC_API_KEY", name: "Anthropic API Key" },
  codex: { envVar: "OPENAI_API_KEY", name: "OpenAI API Key" },
  gemini: { envVar: "GEMINI_API_KEY", name: "Gemini API Key" },
  opencode: { envVar: "OPENAI_API_KEY", name: "OpenAI API Key" }, // OpenCode typically uses OpenAI
}

function parseArgs(): { provider: ProviderName; model?: string } {
  const args = process.argv.slice(2)
  let provider: ProviderName = "claude" // Default
  let model: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--provider" || args[i] === "-p") {
      const providerName = args[i + 1]
      if (!providerName) {
        console.error("Error: --provider requires a provider name")
        console.error(`Valid providers: ${getProviderNames().join(", ")}`)
        process.exit(1)
      }
      if (!isValidProvider(providerName)) {
        console.error(`Error: Unknown provider '${providerName}'`)
        console.error(`Valid providers: ${getProviderNames().join(", ")}`)
        process.exit(1)
      }
      provider = providerName
      i++ // Skip next arg
    } else if (args[i] === "--model" || args[i] === "-m") {
      model = args[i + 1]
      if (!model) {
        console.error("Error: --model requires a model name")
        process.exit(1)
      }
      i++ // Skip next arg
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
Code Agent SDK - Interactive REPL

Usage: npx tsx scripts/repl.ts [options]

Options:
  -p, --provider <name>  Provider to use (default: claude)
  -m, --model <model>    Model to use (provider-specific)
  -h, --help             Show this help message

Supported providers: ${getProviderNames().join(", ")}

Model examples:
  Claude:   sonnet, opus, haiku, claude-sonnet-4-5-20250929
  OpenCode: openai/gpt-4o, openai/o1, anthropic/claude-sonnet
  Codex:    gpt-4o, o1, o3
  Gemini:   gemini-2.0-flash, gemini-1.5-pro

Environment variables:
  DAYTONA_API_KEY     Required for all providers (sandbox execution)
  ANTHROPIC_API_KEY   Required for claude provider
  OPENAI_API_KEY      Required for codex and opencode providers
  GEMINI_API_KEY      Required for gemini provider
`)
      process.exit(0)
    }
  }

  return { provider, model }
}

const { provider: selectedProvider, model: selectedModel } = parseArgs()

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const providerKeyConfig = PROVIDER_API_KEYS[selectedProvider]
const PROVIDER_API_KEY = process.env[providerKeyConfig.envVar]

if (!DAYTONA_API_KEY) {
  console.error("Error: DAYTONA_API_KEY environment variable is required")
  process.exit(1)
}

if (!PROVIDER_API_KEY) {
  console.error(`Error: ${providerKeyConfig.envVar} environment variable is required for ${selectedProvider} provider`)
  process.exit(1)
}

async function main() {
  console.log("============================================================")
  console.log("  Code Agent SDK - Interactive REPL")
  console.log(`  Provider: ${selectedProvider}${selectedModel ? ` (model: ${selectedModel})` : ""}`)
  console.log("============================================================")
  console.log()
  console.log("Creating sandbox...")
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { [providerKeyConfig.envVar]: PROVIDER_API_KEY! },
  })
  console.log("Sandbox created!")
  console.log()

  const env = { [providerKeyConfig.envVar]: PROVIDER_API_KEY! }
  const provider = createProvider(selectedProvider, { sandbox, env })

  console.log(`${selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)} ready.`)
  console.log()
  console.log("Commands:")
  console.log(`  Type a prompt and press Enter to send to ${selectedProvider}`)
  console.log("  /quit or /exit - Exit the REPL")
  console.log("  /clear - Clear session (start fresh)")
  console.log("------------------------------------------------------------")
  console.log()

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question("\x1b[36mYou:\x1b[0m ", async (input) => {
      const trimmed = input.trim()

      if (!trimmed) {
        prompt()
        return
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        console.log("\nDestroying sandbox...")
        await sandbox.delete()
        console.log("Goodbye!")
        rl.close()
        process.exit(0)
      }

      if (trimmed === "/clear") {
        provider.sessionId = null
        console.log("Session cleared.\n")
        prompt()
        return
      }

      try {
        // Show thinking indicator
        process.stdout.write("\x1b[90mThinking...\x1b[0m")
        let firstToken = true
        let sawAnyOutput = false

        const providerLabel = selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1)

        for await (const event of provider.run({ prompt: trimmed, model: selectedModel, timeout: 120 })) {
          // Session events are captured internally; don't print them in REPL output.
          if (event.type === "session") continue
          if (event.type === "token") {
            if (firstToken) {
              // Clear "Thinking..." and show provider's response
              process.stdout.write(`\r\x1b[K\x1b[33m${providerLabel}:\x1b[0m `)
              firstToken = false
            }
            sawAnyOutput = true
            process.stdout.write(event.text)
          } else if (event.type === "tool_start") {
            if (firstToken) {
              // Clear "Thinking..." and show provider label even if first output is a tool.
              process.stdout.write(`\r\x1b[K\x1b[33m${providerLabel}:\x1b[0m\n`)
              firstToken = false
            }
            sawAnyOutput = true
            process.stdout.write(`\x1b[90m[Using tool: ${event.name}]\x1b[0m\n`)
            if (event.input !== undefined) {
              process.stdout.write(`\x1b[90m[Tool input: ${JSON.stringify(event.input)}]\x1b[0m\n`)
            }
          } else if (event.type === "tool_end") {
            sawAnyOutput = true
            process.stdout.write(`\x1b[90m[Tool completed]\x1b[0m\n`)
            if (event.output !== undefined) {
              const out = event.output.length > 400 ? event.output.slice(0, 400) + "…(truncated)" : event.output
              process.stdout.write(`\x1b[90m[Tool output: ${JSON.stringify(out)}]\x1b[0m\n`)
            }
          } else if (event.type === "end") {
            if (firstToken) {
              // Clear "Thinking..." even if no tokens/tools were emitted
              process.stdout.write("\r\x1b[K")
              firstToken = false
            }
            if (!sawAnyOutput) {
              process.stdout.write("\x1b[33m(no output)\x1b[0m")
            }
            break
          }
        }

        // If the provider ended without emitting end/tokens/tools, clear the indicator.
        if (firstToken) {
          process.stdout.write("\r\x1b[K")
          if (!sawAnyOutput) {
            process.stdout.write("\x1b[33m(no output)\x1b[0m")
          }
        }

        console.log("\n")
      } catch (error) {
        // Clear thinking indicator on error
        process.stdout.write("\r\x1b[K")
        console.error("\n\x1b[31mError:\x1b[0m", error)
        console.log()
      }

      prompt()
    })
  }

  // Handle Ctrl+C gracefully
  rl.on("close", async () => {
    console.log("\nDestroying sandbox...")
    await sandbox.delete()
    console.log("Goodbye!")
    process.exit(0)
  })

  prompt()
}

main().catch((error) => {
  console.error("Failed to start REPL:", error)
  process.exit(1)
})
