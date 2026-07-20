# Learn Background Agents

Background Agents runs AI coding agents — Claude, Codex, Copilot, Droid, Gemini, Goose, Kilo, Kimi, OpenCode, and Pi — inside isolated [Daytona](https://daytona.io) sandboxes. Every chat is tied to its own Git branch, so an agent can edit code, run it, and open a pull request without ever touching your machine.

These docs pair a **feature** reference with worked **examples**. The feature pages cover each building block on its own; the examples put them together into things worth building — automations that turn issues into pull requests or summarize your inbox while you sleep, and small apps you can ship in a single session.

:::media type="video" file="overview.mp4" duration="~1m45s"
A quick tour: create a chat, pick an agent, watch it work in a sandbox, and open a PR.
:::

## The building blocks

Each feature works standalone — read whichever one you need.

| Feature | What it does | Page |
|---------|--------------|------|
| **Connect a repository** | Connect a GitHub repo to a chat and get an isolated working branch in the sandbox. | [Connect a repository](#/github) |
| **Jobs** | Run agents unattended — on a schedule or via a webhook URL, with or without a repo. | [Jobs](#/jobs) |
| **MCP servers** | Give agents extra tools (search, APIs, your own services) via the Smithery registry. | [MCP servers](#/mcp) |
| **GitHub MCP** | The special, GitHub-authenticated MCP server for issue/PR/repo tools. | [GitHub MCP](#/github-mcp) |
| **Skills** | Install repo-scoped agent skills from the [skills.sh](https://skills.sh) marketplace. | [Skills](#/skills) |
| **Custom endpoints** | Point an agent at your own, self-hosted, or proxied model API. | [Custom endpoints](#/custom-endpoints) |

## Start with an example

Each example leans on one or more of the features above and walks the whole thing end to end.

<div class="cards">
  <a class="card" href="#/issue-to-pr"><span class="kicker">Automation</span><h3>Issue → pull request</h3><p>A new GitHub issue fires an agent that implements it in a sandbox and opens a PR.</p></a>
  <a class="card" href="#/email-digest"><span class="kicker">Automation</span><h3>Daily email digest</h3><p>A repo-less scheduled agent reads your inbox and writes a morning summary to Notion.</p></a>
  <a class="card" href="#/mini-game"><span class="kicker">Build</span><h3>Build a mini-game</h3><p>Have an agent build and preview an interactive browser toy inside a sandbox.</p></a>
  <a class="card" href="#/agent-battle"><span class="kicker">Explore</span><h3>Agent Battle</h3><p>Send one prompt to several agents and compare how each one solves it.</p></a>
</div>

## How a chat works

1. **Create a chat** and choose an agent and model.
2. A fresh **Daytona sandbox** spins up, and if you connected a repo, it's cloned onto a new branch.
3. You give the agent a task. It edits files, runs commands in the built-in terminal, and streams its reasoning back to you.
4. When you're happy, the agent **opens a pull request** — or you keep iterating.

:::media type="image" file="chat-overview.png"
The chat view: conversation on the left, the agent's tools and terminal output inline, model selector top-right.
:::

## Share a chat

Any chat can be shared with a public link — hand someone a read-only view of the conversation, the agent's work, and the result without giving them access to your account.

:::media type="gif" file="share-link.gif" duration="~25s"
Creating a share link for a chat and opening the public, read-only view.
:::

## What you need

- Sign in with GitHub to connect repositories.
- At least one model credential — a provider API key, a Claude subscription, or a [custom endpoint](#/custom-endpoints).

> [!NOTE]
> Running your own instance? Setup and configuration live in the [repository README](https://github.com/jamesmurdza/background-agents#readme).

> [!TIP]
> New here? Do [Issue → pull request](#/issue-to-pr) first. It touches sandboxes, GitHub, PRs, and the Jobs engine in one go, so everything else will feel familiar afterward.
