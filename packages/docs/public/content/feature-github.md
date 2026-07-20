# Connect a repository

Sign in with GitHub and connect a repository to a chat. The app clones it into the chat's sandbox on a fresh branch — isolated from your local checkout and from `main` — so an agent can edit the code, run it, and commit without ever touching your machine.

:::media type="gif" file="connect-repo.gif" duration="~20s"
Connecting a GitHub repository to a chat and seeing the new working branch.
:::

## Connect

Open a chat, pick a repository from the selector, and the app clones it into the sandbox on its own branch. Multiple chats can use the same repo — each gets its own branch, so they never collide, and the worst case for any run is a branch you delete.

> [!NOTE]
> You can also run with **no repository** at all — the agent works in an empty sandbox with nothing to clone. That's how the [Daily email digest](#/email-digest) automation works.

## Next

- Run agents against your repo unattended → [Jobs](#/jobs)
- Give an agent issue/PR tools → [GitHub MCP](#/github-mcp)
