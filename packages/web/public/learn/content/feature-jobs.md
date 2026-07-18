# Jobs

The **/jobs** page is where agents run without you sitting in the chat. A job (called a **Scheduled Agent** in the UI) pairs a prompt with a trigger, runs the agent in a sandbox when that trigger fires, and records every run. Attach a repository and it can open a pull request; leave the repository off and it does pure tool-driven work instead.

To connect the repository a job works in, see [Connect a repository](#/github).

:::media type="image" file="jobs-list.png"
The /jobs page listing your agents with their trigger, last run, and status.
:::

## Two triggers

When you create an agent, the **Trigger** control offers two modes.

### On a schedule

Runs on a recurring interval — every 10 minutes up to weekly, or a custom value. For daily and weekly intervals you also pick the **time** (in your local timezone, stored as UTC) and, for weekly, the **day**. Ideal for anything that should just happen on a clock.

:::media type="image" file="scheduled-job-form.png"
The schedule row: "Run every Day at 9:00 AM", with the day/time controls for longer intervals.
:::

Walk through a complete example in [Daily email digest](#/email-digest).

### Via webhook

Generates a unique URL — `…/wh/<token>` — that fires the agent whenever any external app POSTs to it. The entire request payload is handed to the agent as context. GitHub, Jira, Linear, Slack, a cron box, or a plain `curl` all work; paste the URL into the source app.

:::media type="image" file="webhook-url-panel.png"
The webhook trigger showing the generated URL with Copy and Rotate buttons.
:::

> [!IMPORTANT]
> The URL *is* the authentication — anyone who has it can fire the agent. Rotate it from the form if it leaks.

Walk through a complete example in [Issue → pull request](#/issue-to-pr).

## With or without a repository

- **With a repo:** the agent works on a branch in a cloned sandbox and can **auto-create a PR** when the run produces commits.
- **Repo-less:** leave the repository empty and the agent runs in a no-clone sandbox. There's nothing to push, so the auto-PR option disappears — the work product lives in whatever [MCP tools](#/mcp) the agent calls. This is what powers the [Daily email digest](#/email-digest).

## Agent, model, and tools

Scheduled Agents run on **OpenCode, Claude Code, or Codex**, each with its own model selector (custom endpoints included). You can attach [MCP servers](#/mcp) — or the [GitHub MCP server](#/github-mcp) — right from the form, so an automation has the same tools every time it runs.

## Writing the prompt

A job's prompt runs every time it fires, with no one there to clarify — so be specific:

- **State the goal and the boundaries.** "Only act when the issue action is `opened`; don't touch unrelated files."
- **Tell it how to verify.** Give the exact test or lint command so the agent checks its own work before finishing.
- **Keep one job to one purpose.** Narrow jobs produce small, reviewable results.

## Options

- **Automatically create PR when there are new commits** — repo-backed jobs only.
- **Include the previous run's output as context** (repo-less) / **Include commits from the previous run** (with a repo) — chain each run onto the last.

## Run history

Every run is recorded with its full output so you can see exactly what the agent did.

:::media type="image" file="run-detail.png"
A run detail page (`/jobs/[jobId]/runs/[runId]`): status, the agent's streamed reasoning and commands, and a link to any PR it opened.
:::

> [!IMPORTANT]
> Jobs act on your repositories and tools on their own. Keep branch protection on, require review on auto-PRs, and scope each job's prompt narrowly so it changes only what you intend.

## Next

- Build a webhook-triggered job end to end → [Issue → pull request](#/issue-to-pr)
- Build a repo-less scheduled job end to end → [Daily email digest](#/email-digest)
- Give a job extra tools → [MCP servers](#/mcp)
