#!/usr/bin/env npx tsx
/**
 * Polling-based REPL for testing the Coding Agents SDK.
 *
 * Instead of streaming directly from the PTY, this REPL starts a
 * sandboxed background run and polls a JSONL log file inside the
 * sandbox using startSandboxBackground / pollSandboxBackground.
 */
import * as readline from "node:readline"
import { Daytona } from "@daytonaio/sdk"
import {
  createSession,
  getSession,
  getAgentNames,
} from "../src/index.js"

type AgentName = "claude" | "codex" | "gemini" | "opencode"

function isValidAgent(name: string): name is AgentName {
  return getAgentNames().includes(name)
}

// Agent -> API key environment variable mapping
const AGENT_API_KEYS: Record<AgentName, { envVar: string; name: string }> = {
  claude: { envVar: "ANTHROPIC_API_KEY", name: "Anthropic API Key" },
  codex: { envVar: "OPENAI_API_KEY", name: "OpenAI API Key" },
  gemini: { envVar: "GEMINI_API_KEY", name: "Gemini API Key" },
  opencode: { envVar: "OPENAI_API_KEY", name: "OpenAI API Key" }, // OpenCode typically uses OpenAI
}

function parseArgs(): { agent: AgentName; model?: string } {
  const args = process.argv.slice(2)
  let agent: AgentName = "claude" // Default
  let model: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--agent" || args[i] === "-a") {
      const agentName = args[i + 1]
      if (!agentName) {
        console.error("Error: --agent requires an agent name")
        console.error(`Valid agents: ${getAgentNames().join(", ")}`)
        process.exit(1)
      }
      if (!isValidAgent(agentName)) {
        console.error(`Error: Unknown agent '${agentName}'`)
        console.error(`Valid agents: ${getAgentNames().join(", ")}`)
        process.exit(1)
      }
      agent = agentName
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
Coding Agents SDK - Polling REPL

Usage: npx tsx scripts/repl-polling.ts [options]

Options:
  -a, --agent <name>   Agent to use (default: claude)
  -m, --model <model>  Model to use (agent-specific)
  -h, --help           Show this help message

Supported agents: ${getAgentNames().join(", ")}

Environment variables:
  DAYTONA_API_KEY     Required for all agents (sandbox execution)
  ANTHROPIC_API_KEY   Required for claude agent
  OPENAI_API_KEY      Required for codex and opencode agents
  GEMINI_API_KEY      Required for gemini agent
`)
      process.exit(0)
    }
  }

  return { agent, model }
}

const { agent: selectedAgent, model: selectedModel } = parseArgs()

const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY
const agentKeyConfig = AGENT_API_KEYS[selectedAgent]
const AGENT_API_KEY = process.env[agentKeyConfig.envVar]

if (!DAYTONA_API_KEY) {
  console.error("Error: DAYTONA_API_KEY environment variable is required")
  process.exit(1)
}

if (!AGENT_API_KEY) {
  console.error(`Error: ${agentKeyConfig.envVar} environment variable is required for ${selectedAgent} agent`)
  process.exit(1)
}

async function main() {
  console.log("============================================================")
  console.log("  Coding Agents SDK - Polling REPL")
  console.log(`  Agent: ${selectedAgent}${selectedModel ? ` (model: ${selectedModel})` : ""}`)
  console.log("============================================================")
  console.log()
  console.log("Creating sandbox...")
  const daytona = new Daytona({ apiKey: DAYTONA_API_KEY })
  const sandbox = await daytona.create({
    envVars: { [agentKeyConfig.envVar]: AGENT_API_KEY! },
  })
  console.log("Sandbox created!")
  console.log()

  const session = await createSession(selectedAgent, {
    sandbox,
    model: selectedModel,
    timeout: 120,
    systemPrompt: "You are a helpful coding assistant who responds in clear, concise French.",
  })

  const sessionId = session.id
  const sandboxId = sandbox.id
  let hasStarted = false

  console.log(`${selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)} ready (polling mode). Session ID: ${session.id}`)
  console.log()
  console.log("Commands:")
  console.log(`  Type a prompt and press Enter to send to ${selectedAgent}`)
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
        console.log("Session cleared.\n")
        prompt()
        return
      }

      try {
        // On first prompt, use the existing session so meta is created.
        // On subsequent prompts, re-fetch sandbox and session to simulate reconnect.
        const sandboxForTurn = hasStarted ? await daytona.get(sandboxId) : sandbox
        const currentSession = hasStarted
          ? await getSession(sessionId, { sandbox: sandboxForTurn })
          : session

        // Show thinking indicator
        process.stdout.write("\x1b[90mThinking (polling)...\x1b[0m")
        let firstToken = true
        let sawAnyOutput = false

        const agentLabel = selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)

        // Start background run
        await currentSession.start(trimmed)
        hasStarted = true
        let done = false

        while (!done) {
          const res = await currentSession.getEvents()
          // Use res.running (not isRunning()) so startup grace matches getEvents / runPhase.
          const turnActive = res.running

          for (const event of res.events) {
            // Session events are captured internally; don't print them in REPL output.
            if (event.type === "session") continue
            if (event.type === "token") {
              if (firstToken) {
                // Clear "Thinking..." and show agent's response
                process.stdout.write(`\r\x1b[K\x1b[33m${agentLabel}:\x1b[0m `)
                firstToken = false
              }
              sawAnyOutput = true
              process.stdout.write(event.text)
            } else if (event.type === "tool_start") {
              if (firstToken) {
                // Clear "Thinking..." and show agent label even if first output is a tool.
                process.stdout.write(`\r\x1b[K\x1b[33m${agentLabel}:\x1b[0m\n`)
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
              done = true
            }
          }

          if (!done && !turnActive) {
            done = true
            console.log("\n\x1b[90m(agent process stopped)\x1b[0m")
          }
          if (!done) {
            await new Promise(resolve => setTimeout(resolve, 500))
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
  console.error("Failed to start polling REPL:", error)
  process.exit(1)
})

