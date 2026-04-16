# Building AI Agent Interfaces with the Background Agents SDK

Coding agents like Claude Code, Codex, and OpenCode were originally designed for local-first CLI usage, and integrating them into cloud applications comes with a whole set of challenges. The Background Agents SDK is a solution to those challenges—it gives you a unified interface for starting and managing long-running AI coding agents in cloud sandboxes.

## Introducing the Background Agents SDK

The Background Agents SDK is a TypeScript library that lets you run long-running AI coding agents from serverless applications. You create a sandbox, clone a repo, and start a task:

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSession } from "background-agents"

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await daytona.create()

// Clone a repo and set up a working branch
await sandbox.git.clone("https://github.com/user/repo.git", "/home/daytona/repo")
await sandbox.git.checkoutBranch("/home/daytona/repo", "fix-auth-bug")

// Start the agent in the repo directory
const session = await createSession("claude", {
  sandbox,
  cwd: "/home/daytona/repo",
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
})

await session.start("Refactor the auth module")
```

The agent is now running in an isolated sandbox with your repo cloned into it. To use a different agent, change `"claude"` to any of the supported agents: `"codex"`, `"gemini"`, `"goose"`, `"opencode"`, or `"pi"`.

## Why Sandboxes?

Coding agents execute code, read files, write files, and run shell commands. Sandboxes give you isolation. Each agent runs in its own Daytona environment, finishes its task, and can be deleted when you're done.

The sandbox also persists the state of the agent. In serverless applications, functions can only run for a limited time, but Daytona sandboxes allow the agent to run indefinitely. Your application only needs to persist the sandbox and session IDs.

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

The SDK tracks which events you've already seen. Each call to `getEvents()` returns only the new ones.

## Event Types

Since every agent has its own output format, the SDK normalizes them into a common event structure:

| Event | Description |
|-------|-------------|
| `token` | Text output from the agent |
| `tool_start` | Agent started using a tool (includes tool name and input) |
| `tool_delta` | Streaming output from a tool |
| `tool_end` | Tool finished (includes output) |
| `end` | Agent completed the task |
| `agent_crashed` | Agent process crashed |

Here's what the events look like when an agent edits a file:

```typescript
{ type: "token", text: "I'll update the auth module..." }
{ type: "tool_start", name: "edit", input: { file_path: "src/auth.ts", ... } }
{ type: "tool_end", output: "File updated successfully" }
{ type: "token", text: "Done. The auth module now..." }
{ type: "end" }
```

## Saving to Git

When the agent finishes, push the changes:

```typescript
if (!running) {
  await sandbox.git.push("/home/daytona/repo", "x-access-token", githubToken)
}
```

You can also create a PR using the GitHub API:

```typescript
import { Octokit } from "octokit"

const octokit = new Octokit({ auth: githubToken })

await octokit.request("POST /repos/{owner}/{repo}/pulls", {
  owner: "user",
  repo: "repo",
  title: "Refactor auth module",
  head: "fix-auth-bug",
  base: "main",
})
```

A security benefit of using Daytona to manage the git repo is that the GitHub access token is not stored in the sandbox, which prevents the agent from making any destructive or unwanted changes.

## Adding New Agents

The SDK uses a pluggable registry. Each agent adapter:

1. Installs and runs the agent using its CLI
2. Parses the agent's JSON output into normalized events
3. Maps tool names to a standard format (e.g., `Write` → `write`, `Shell` → `bash`)

---

The Background Agents SDK is open source. Find it on [npm](https://www.npmjs.com/package/background-agents) or [GitHub](https://github.com/jamesmurdza/upstream-agents/tree/main/packages/agents).
