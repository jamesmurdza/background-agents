# Building AI Agent Interfaces with the Background Agents SDK

Coding agents like Claude Code, Codex, and OpenCode were originally designed for local-first CLI usage, and integrating them into cloud applications comes with a whole set of challenges. The Background Agents SDK is a solution to those challenges—it gives you a unified interface for starting and managing long-running AI coding agents in cloud sandboxes.

## Introducing the Background Agents SDK

The Background Agents SDK is a TypeScript library that lets you start long-running AI coding agents from serverless applications. You create a sandbox, clone a repo, create a session, and start a task:

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "background-agents"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

// Clone a repo and set up a working branch
await sandbox.git.clone("https://github.com/user/repo.git", "/home/daytona/repo")
await sandbox.git.checkoutBranch("/home/daytona/repo", "fix-auth-bug")

// Start the agent
const session = await createSession("claude", {
  sandbox,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
})

await session.start("Refactor the auth module")
```

The agent is now running in an isolated sandbox with your repo cloned into it. To use a different agent, change `"claude"` to any of the supported agents: `"codex"`, `"gemini"`, `"goose"`, `"opencode"`, or `"pi"`.

## Long-Running Agents

Coding agents can run from a few minutes to much longer. For a serverless application, we need to be able to reconnect to running agent sessions to check their status later.

When you start a session, save the sandbox ID (`sandbox.id`) and session ID (`session.id`). Later, you can reconnect:

```typescript
const sandbox = await daytona.get(sandboxId)
const session = await getSession(sessionId, { sandbox })

const { events, running } = await session.getEvents()
for (const event of events) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "tool_start") console.log(`\n[Tool: ${event.name}]`)
}
```

The SDK tracks which events you've already seen. Each call to `getEvents()` returns only the new ones. Since every agent has its own output format, the SDK normalizes them into a common event structure.

When the agent finishes, push the changes:

```typescript
if (!running) {
  await sandbox.git.push("/home/daytona/repo", "x-access-token", githubToken)
}
```

A security benefit of using Daytona to manage the git repo is that the GitHub access token is not stored in the sandbox, which prevents the agent from making any destructive or unwanted changes.

## Why Sandboxes?

Coding agents execute code, read files, write files, and run shell commands. Sandboxes give you isolation. Each agent runs in its own Daytona environment, finishes its task, and can be deleted when you're done.

The sandbox also persists the state of the agent. In serverless applications, functions can only run for a limited time, but Daytona sandboxes allow the agent to run indefinitely. Your application only needs to persist the sandbox and session IDs.

## Adding New Agents

The SDK uses a pluggable registry. Each agent adapter implements how to build the CLI command, parse its JSON output, and map tool names to a common format.

We built an agentic workflow for adding new adapters. You create a skeleton module, run a script that captures the agent's raw output, then iteratively build the parser from that. The agents can help—point Claude at the captured JSON and the existing adapters, and it drafts most of the code for you.

## Building the Chat Interface

We built an example chat application on top of the SDK to show how the pieces connect. It's intentionally minimal—no database, just local storage.

The core is a polling loop. Send a message, the app creates a session and starts polling. Events come back and get rendered as they arrive: tokens stream in as the agent "types," tool calls show what's happening, and completion ends the loop.

The UI renders tool calls inline, so you see exactly what the agent did. File edits show diffs, command outputs collapse, errors get highlighted.

## Git & GitHub Integration

Each conversation in the chat app is tied to a git branch. Start a new chat, get a new branch. The agent makes changes, they're tracked in git.

When you're done:

1. Type `/commit`—the agent writes a commit message
2. Type `/pr`—a pull request opens on GitHub
3. Merge it

The whole workflow happens in the sandbox. If you don't like the result, delete the sandbox and the branch goes with it. Nothing touches your main codebase until you merge.

---

The Background Agents SDK is open source. If you're building on top of AI coding agents, it might save you some time.
