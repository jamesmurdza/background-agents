# Issue → pull request

**Goal:** the moment someone opens a GitHub issue, an agent spins up, reads the issue, implements it in a sandbox, and opens a pull request — automated triage, no human in the loop until review.

This is the flagship automation. It uses a **Via webhook** agent: a job that fires when an external app POSTs to a URL you own. Here that external app is GitHub itself, sending an `issues` event.

:::media type="video" file="coding-automation.mp4" duration="~2–3 min"
End to end: open an issue on GitHub, watch the agent fire, read the issue in a sandbox, implement the change, and open a pull request that closes it. The voiceover explains each step.
:::

## How it works

```
GitHub issue opened ──► repo webhook ──► /wh/<token> ──► agent in sandbox ──► fix ──► pull request
```

Each **Via webhook** agent has its own URL, `…/wh/<token>`. Anything that POSTs JSON to it fires the agent, and the whole payload is handed to the agent as context. Point a GitHub repository webhook (on the *Issues* event) at that URL, and every new issue becomes a run.

## Prerequisites

- A repository connected to the app — see [Connect a repository](#/github).
- Admin access to that repo on GitHub (to add a webhook).
- A model credential for the agent you pick.

## Step 1 — Create the agent and grab its URL

Go to **/jobs**, create a new Scheduled Agent, and select the repository to work in. Set **Trigger** to **Via webhook**. A **Webhook URL** appears — copy it with the copy button.

:::media type="image" file="webhook-url-panel.png"
The webhook trigger: the generated `…/wh/<token>` URL with Copy and Rotate buttons. Anyone with the URL can fire the agent, so rotate it if it leaks.
:::

## Step 2 — Point GitHub at the URL

In the repo on GitHub: **Settings → Webhooks → Add webhook**. Paste the URL as the **Payload URL**, set **Content type** to `application/json`, choose **Let me select individual events**, and tick **Issues**. Save.

GitHub now POSTs to your agent every time an issue is opened, edited, or closed — the prompt decides what to act on.

## Step 3 — Write the instructions

The prompt runs on every fire, with the issue payload available as context. Keep it specific:

```text
A GitHub issue webhook just fired. The payload is provided as context.

Only act when the action is "opened". For any other action, do nothing and stop.

For a newly opened issue:
1. Read the issue title and body to understand what's being asked.
2. Implement the smallest change that satisfies it. If it's a bug, reproduce it
   first; if it's a feature, keep the change focused.
3. Run the test suite and confirm it passes before finishing.
4. In the PR description, summarize what you changed and add "Closes #<number>".

If the issue is unclear or too large to do safely in one pass, open no PR and
explain what you'd need in a comment on the run instead.
```

Turn on **Automatically create PR when there are new commits** so each run ends with a reviewable PR.

## Step 4 — Try it

Open an issue on the repo. Within moments the agent fires; open the run to watch it work.

:::media type="image" file="run-detail.png"
A run detail page (`/jobs/[jobId]/runs/[runId]`): status, the agent's streamed reasoning and commands, and a link to the PR it opened.
:::

> [!IMPORTANT]
> Treat auto-PRs as proposals, not merges. Keep branch protection on and require review. The agent proposes; you approve.

## Make it your own

- **Filter in the prompt.** The webhook fires on every issue action — tell the agent exactly which to act on (e.g. only issues labeled `agent`).
- **Fire it from anything.** The same URL works from Jira, Linear, Slack, or a `curl` — GitHub issues is just one source. See [Jobs](#/jobs).
- **Add context tools.** Attach the [GitHub MCP server](#/github-mcp) so the agent can read related issues and prior PRs while it works.

## Next

- Run maintenance on a clock instead of a trigger → [Daily email digest](#/email-digest)
- The full Jobs reference → [Jobs](#/jobs)
