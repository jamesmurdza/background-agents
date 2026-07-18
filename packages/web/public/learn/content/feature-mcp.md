# MCP servers

Model Context Protocol (MCP) servers give agents **extra tools** beyond editing code — web search, database queries, third-party APIs, your own internal services. You attach a server to a chat or a job, and the agent can call its tools mid-task.

Servers come from the **[Smithery](https://smithery.ai) registry**, a marketplace of hosted MCP servers connected per-server with OAuth.

> [!NOTE]
> GitHub has its own hosted MCP server that works a little differently — it's authenticated with short-lived installation tokens and needs a GitHub App. It gets its own page: [GitHub MCP](#/github-mcp).

:::media type="gif" file="Smithry-Mcp-connect.gif" duration="~12s"
Connecting an MCP server to a chat: search Smithery, connect, approve OAuth, and the new tools become available to the agent.
:::

## Attach a server to a chat

Open the MCP panel for a chat, search the Smithery registry, and connect. Some servers need an OAuth step — you'll be redirected to authorize, then dropped back with the connection live.

:::media type="image" file="mcp-panel.png"
The MCP panel: connected servers listed, with a search box to add more from Smithery.
:::

Once connected, the server's tools show up to the agent automatically. Ask it to use them — for example, "search the web for the current API and update our client."

## Attach servers to jobs, too

MCP isn't just for interactive chats. Attach a server to a [scheduled or triggered job](#/jobs) so an automation has the same tools every time it runs.

## Tips

- **Attach only what the task needs.** Every extra tool is another thing the agent can wander into. Fewer, sharper tools produce better runs.
- **Name the tool in your prompt.** "Use the search tool to find the current API" beats hoping the agent discovers it.
- **Watch for auth expiry.** Smithery OAuth connections can lapse; reconnect from the MCP panel if a tool starts failing.

## Setup

To enable Smithery-hosted servers, the deployment needs a `SMITHERY_API_KEY` (and optionally a `SMITHERY_NAMESPACE`). See the [mcp package README](https://github.com/jamesmurdza/background-agents/tree/main/packages/mcp) for details.

## Next

- The special, GitHub-authenticated server → [GitHub MCP](#/github-mcp)
- Add repo-scoped *procedures* instead of tools → [Skills](#/skills)
