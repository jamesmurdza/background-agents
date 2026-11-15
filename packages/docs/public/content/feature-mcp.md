# MCP servers

Model Context Protocol (MCP) servers give agents **extra tools** beyond editing code — issue trackers, docs, databases, error monitoring, web search. You attach a server to a chat or a job, and the agent can call its tools mid-task.

You can attach:

- **Vendors' own hosted servers**: Linear, Notion, Sentry, Atlassian (Jira and Confluence), Supabase, Neon, Cloudflare, Hugging Face, monday.com, Exa, Paddle and Context7. You sign in to each one with that vendor's own login.
- **Gmail**, through our own server, which limits what the agent can do with your mail.
- **GitHub**, through our GitHub App.

> [!NOTE]
> GitHub's MCP server works a little differently — it's authenticated with short-lived installation tokens and needs a GitHub App. It gets its own page: [GitHub MCP](#/github-mcp).

## Attach a server to a chat

Open the MCP panel for a chat and pick a server. The first time, a popup asks you to sign in to that service and approve access. After that, the server attaches right away, to this chat or any other.

:::media type="image" file="mcp-panel.png"
The MCP panel: attached servers at the top, with a search box to find the others.
:::

Once connected, the server's tools show up to the agent automatically. Ask it to use them — for example, "search the web for the current API and update our client."

## Attach servers to jobs, too

MCP isn't just for interactive chats. Attach a server to a [scheduled or triggered job](#/jobs) so an automation has the same tools every time it runs.

## Tips

- **Attach only what the task needs.** Every extra tool is another thing the agent can wander into. Fewer, sharper tools produce better runs.
- **Name the tool in your prompt.** "Use the search tool to find the current API" beats hoping the agent discovers it.
- **Reconnect if access was revoked.** If you remove access on the vendor's side, or the login expires, the server shows an error. Reconnect it in Settings → Integrations and your chats and jobs pick it up again.

## Setup

Vendor servers need one secret on the deployment, `MCP_OAUTH_STATE_SECRET`; there's nothing to register per vendor. GitHub and Gmail have their own setup. See the [mcp package README](https://github.com/jamesmurdza/background-agents/tree/main/packages/mcp) for details.

## Next

- The special, GitHub-authenticated server → [GitHub MCP](#/github-mcp)
- Add repo-scoped *procedures* instead of tools → [Skills](#/skills)
