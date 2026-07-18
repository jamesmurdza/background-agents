# GitHub MCP

The GitHub MCP server is a **special** MCP server. Unlike the [Smithery-hosted servers](#/mcp), it's GitHub's own hosted server, it's authenticated with **short-lived installation tokens**, and it needs a **GitHub App** rather than an OAuth marketplace flow. That's why it gets its own page.

It gives an agent tools to read and write **issues, pull requests, and repository contents** through GitHub's API — so an agent can pull in the context around the code it's changing, not just the code itself.

:::media type="image" file="github-mcp-connected.png"
The GitHub MCP server connected to a chat, exposing issue and PR tools to the agent.
:::

## Why it's different

| | Smithery MCP servers | GitHub MCP |
|--|----------------------|------------|
| Source | Smithery marketplace | GitHub's own hosted server |
| Auth | Per-server OAuth | Short-lived **installation tokens**, minted per request |
| Setup | `SMITHERY_API_KEY` | A configured **GitHub App** |
| Scope | Whatever the server offers | Issues, PRs, repo contents on installed repos |

Because tokens are minted per request and are short-lived, no long-lived GitHub credential ever sits in the sandbox.

## Connect it

With the GitHub App configured for the deployment, connect the GitHub MCP server to a chat (or a job) from the MCP panel. Once connected, its tools are available to the agent.

:::media type="gif" file="github-mcp-connect.gif" duration="~12s"
Connecting the GitHub MCP server and the agent using an issue/PR tool.
:::

## What agents do with it

- **Read context while coding** — "find the issue this branch closes and make sure the fix matches it."
- **Cross-reference PRs** — "check how the last similar change was reviewed before opening this PR."
- **Power automations** — attach it to the [Issue → pull request](#/issue-to-pr) job so the agent can read related issues and prior PRs while it works.

## Setup

Enabling GitHub MCP requires a GitHub App configured on the deployment:

```bash
GITHUB_APP_ID="..."
GITHUB_APP_SLUG="..."
GITHUB_APP_PRIVATE_KEY="..."
```

The one-time App creation (permissions, making it public, generating the private key) is documented in the [mcp package README](https://github.com/jamesmurdza/background-agents/tree/main/packages/mcp#github-app-setup).

> [!TIP]
> GitHub MCP (read/write issues & PRs via the API) is complementary to working directly in a [connected repository](#/github). The agent commits to the branch to *ship* the change; GitHub MCP gives it the *context* — issues and prior PRs — while it works.

## Next

- The general MCP flow and Smithery servers → [MCP servers](#/mcp)
- Connect a repository to a chat → [Connect a repository](#/github)
