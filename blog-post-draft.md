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

The agent is now running in an isolated sandbox with your repo cloned into it. Your serverless function can return—the sandbox keeps running independently.

To use a different agent, change `"claude"` to any of the supported agents: `"codex"`, `"gemini"`, `"goose"`, `"opencode"`, or `"pi"`.

## Long-Running Agents

Serverless functions time out. Servers restart. But coding agents can run for minutes—sometimes longer. The SDK is built around this constraint.

When you start a session, save the sandbox ID (`sandbox.id`) and session ID (`session.id`). Later—from a new request, a different server, whenever—you reconnect:

```typescript
const sandbox = await daytona.get(sandboxId)
const session = await getSession(sessionId, { sandbox })

const { events, running } = await session.getEvents()
for (const event of events) {
  if (event.type === "token") process.stdout.write(event.text)
  if (event.type === "tool_start") console.log(`\n[Tool: ${event.name}]`)
}
```

The SDK tracks which events you've already seen. Each call to `getEvents()` returns only the new ones.

When the agent finishes, push the changes:

```typescript
if (!running) {
  await sandbox.git.push("/home/daytona/repo", "x-access-token", githubToken)
}
```

Since the GitHub access token is not stored in the sandbox, this prevents the agent from making any unwanted changes.

## Why Sandboxes?

These agents execute real code—reading files, writing files, running shell commands, interacting with git. You don't want that happening on your server.

Sandboxes give you isolation. Each agent runs in its own Daytona environment, does whatever it needs to do, and can be deleted when you're done. If something goes wrong, you haven't lost anything.

But for serverless applications, the bigger benefit is persistence. Your function might time out, your server might restart, but the sandbox keeps running. Save the IDs, reconnect later, pick up where you left off.

## Adding New Agents

The SDK uses a pluggable registry. Each agent adapter implements a simple interface: how to build the CLI command, how to parse its JSON output, and how to map tool names to a common format.

We built an agentic workflow for adding new adapters:

1. Create a skeleton module with just the CLI command
2. Run a script that captures the agent's raw JSON output
3. Use that output to build the parser iteratively

The agents can help build their own integrations. Point Claude at the captured JSON and the existing adapters, and it drafts most of the parser for you.

## Building the Chat Interface

Simple Chat is a Next.js app we built on top of the SDK. It's intentionally minimal—no database, just local storage—so you can see how the pieces connect.

The core is a polling loop. Send a message, the app creates a session and starts polling. Events come back and get rendered as they arrive:

- Tokens stream in as the agent "types"
- Tool calls show what's happening (file reads, edits, commands)
- Completion ends the loop

The UI renders tool calls inline, so you see exactly what the agent did. File edits show diffs, command outputs collapse, errors get highlighted.

## Git & GitHub Integration

Each conversation in Simple Chat is tied to a git branch. Start a new chat, get a new branch. The agent makes changes, they're tracked in git.

When you're done:

1. Type `/commit`—the agent writes a commit message
2. Type `/pr`—a pull request opens on GitHub
3. Merge it

The whole workflow happens in the sandbox. If you don't like the result, delete the sandbox and the branch goes with it. Nothing touches your main codebase until you merge.

---

The Background Agents SDK and Simple Chat are both open source. If you're building on top of AI coding agents, they might save you some time.
