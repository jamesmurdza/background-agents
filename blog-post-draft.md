# Building AI Agent Interfaces with the Background Agents SDK

Coding agents like Claude Code, Codex, and OpenCode were originally designed for local-first CLI usage, and integrating them into cloud applications comes with a whole set of challenges. The Background Agents SDK is a solution to those challenges—it gives you a unified interface for starting, polling, and managing long-running AI coding agents from serverless applications.

## Introducing the Background Agents SDK

The Background Agents SDK is a TypeScript library that lets you install and start long-running AI coding agents from serverless applications. You just create a sandbox, create a session, and start a task:

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "background-agents"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
})

await session.start("Refactor the auth module")

// Remember sandbox.id and session.id
```

Now, with just a few lines of code, a coding agent is running in an isolated sandbox. In order to check on our coding agent later, we use:

```typescript
const sandbox = await daytona.get(sandboxId)
const session = await getSession(sessionId, { sandbox })

const { events, running } = await session.getEvents()
for (const event of events) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "tool_start") console.log(`\n[Tool: ${event.name}]`)
}
```

To make this work with a different agent, we could have changed `"claude"` to any of the supported agents: `"codex"`, `"gemini"`, `"goose"`, `"opencode"`, or `"pi"`.

## Why Put CLI Agents in Sandboxes?

AI coding agents are powerful precisely because they can execute real code. They read files, write files, run shell commands, and interact with git. That's also what makes them risky to run on your local machine or a shared server.

Sandboxes solve this problem. Each agent session runs in an isolated Daytona environment where it can do whatever it needs without affecting your system. If something goes wrong, you just delete the sandbox and start fresh.

Beyond security, sandboxes give you:

- **Reproducibility**: Every session starts from a clean state
- **Persistence**: Sessions survive server restarts—you can disconnect and reconnect later
- **Easy cleanup**: No leftover files or processes when you're done

The SDK handles all of this for you. It installs the agent CLI in the sandbox, runs it in the background, and polls for events. You just ask for events and render them however you want.

## Using the SDK

Here's the basic workflow:

**1. Create a sandbox and session:**

```typescript
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
  model: "sonnet",
  systemPrompt: "You are a helpful coding assistant.",
})
```

**2. Start a task:**

```typescript
await session.start("Create a hello world script")
```

**3. Poll for events:**

```typescript
while (await session.isRunning()) {
  const { events } = await session.getEvents()
  for (const event of events) {
    switch (event.type) {
      case "token":
        process.stdout.write(event.text)
        break
      case "tool_start":
        console.log(`\n[Using tool: ${event.name}]`)
        break
      case "tool_end":
        console.log(`[Done]`)
        break
    }
  }
  await new Promise(r => setTimeout(r, 1000))
}
```

**4. Clean up:**

```typescript
await sandbox.delete()
```

The same interface works for any supported agent. Swap `"claude"` for `"gemini"` or `"codex"`, adjust your API keys, and everything else stays the same.

## Adding New Agents

We designed the SDK with a pluggable registry architecture. Adding a new agent means implementing a simple interface: how to build the CLI command, how to parse its JSON output, and how to map its tool names to a common format.

To make this even easier, we created an agentic workflow for developing new agent adapters. The process looks like this:

1. Create a skeleton agent module with just the CLI command builder
2. Run a script that executes the agent and captures its raw JSON output
3. Use that output to build and test the parser iteratively
4. Add integration tests

The agents themselves can help build their own integrations. Point Claude at the captured JSON output and the existing agent implementations, and it can draft most of the parser code for you.

## Building the Chat Interface

Simple Chat is a Next.js application that demonstrates what you can build on top of the SDK. It's intentionally minimal—no database, just local storage—so you can see how the pieces fit together.

The core is a polling loop. When you send a message, the app creates a session and starts polling for events. As events come in, they're rendered progressively:

- **Tokens** stream in as the agent "types"
- **Tool calls** show what the agent is doing (reading files, running commands, editing code)
- **Completion** signals when the agent is done

The UI shows tool calls inline with the conversation, so you can see exactly what the agent did and why. File edits show diffs, command outputs are collapsible, and errors are highlighted.

## Git & GitHub Integration

One of Simple Chat's key features is that each conversation is tied to a git branch. When you start a new chat, it creates a branch. As the agent makes changes, they're tracked in git. When you're done, you can commit and create a pull request without leaving the chat.

This gives you a natural workflow:

1. Start a new chat: "Fix the login bug"
2. The agent investigates and makes changes
3. Type `/commit` to create a commit with an auto-generated message
4. Type `/pr` to open a pull request on GitHub
5. Review, merge, done

The git integration runs through the sandbox, so all file operations are isolated. You can experiment freely—if you don't like the result, just delete the sandbox and the branch.

---

The Background Agents SDK and Simple Chat are both open source. If you're building tools on top of AI coding agents, we hope they save you some time.
