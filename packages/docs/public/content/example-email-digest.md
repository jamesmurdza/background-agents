# Daily email digest

**Goal:** every morning at 9 AM, an agent reads the last 24 hours of your email, summarizes it, drafts replies, and writes the whole thing into a Notion page you can skim over coffee — no repository, no code, no pull request.

This one shows a different side of the platform: agents doing **knowledge work** through [MCP tools](#/mcp), on a schedule, with no Git repo attached at all. It's an **On a schedule**, **repo-less** agent.

:::media type="video" file="repo-less.mp4" duration="~2m20s"
Configure a repo-less scheduled agent with the Gmail and Notion MCP servers attached, then open a completed run and the Notion page it produced — a digest of the last 24 hours of email with draft replies.
:::

## How it works

```
9:00 AM daily ──► repo-less sandbox ──► Gmail MCP (read) ──► summarize ──► Notion MCP (write)
```

Because no repository is attached, the agent runs in a no-clone sandbox and there's nothing to commit or push — the work product lives entirely in the tools it calls. Its abilities come from the [MCP servers](#/mcp) you attach: **Gmail** to read mail, **Notion** to write the digest.

## Prerequisites

- A model credential for the agent you pick.
- The **Gmail** and **Notion** MCP servers available to connect (from the Smithery registry) — see [MCP servers](#/mcp).
- No repository required.

## Step 1 — Create a repo-less scheduled agent

On **/jobs**, create a new Scheduled Agent. **Leave the repository empty** — that puts the agent in repo-less mode (you'll notice the auto-PR option disappears, since there's nothing to push to). Set **Trigger** to **On a schedule**.

## Step 2 — Set the schedule

In the schedule row, choose **Run every Day** and set the time to **9:00 AM** in your timezone. The time picker is local; the app stores it in UTC for you.

:::media type="image" file="schedule-daily-9am.png"
The schedule row reading "Run every Day at 9:00 AM" with your local timezone shown.
:::

## Step 3 — Attach the tools

From the agent form's MCP picker, connect the **Gmail** and **Notion** servers. (Adding an MCP server saves the agent as a draft so the connection has something to attach to — finish the form and it goes live.)

## Step 4 — Write the prompt

A repo-less agent lives or dies by its prompt and its tools — say exactly what to read and where to write:

```text
Using the Gmail tools, fetch every email received in the last 24 hours.

Produce a concise morning digest:
- Group messages into: Needs a reply, FYI, and Newsletters/automated.
- For each "Needs a reply" message, write a one-paragraph draft reply I can
  send as-is or tweak.
- Keep the whole thing skimmable — sender, subject, one-line summary per item.

Using the Notion tools, create a new page titled "Email digest — <today's date>"
in my "Daily digests" database and write the digest there. Do not send any
email or take any irreversible action — only read mail and write to Notion.
```

## Step 5 — Let it run (or run it now)

Scheduled agents fire on their interval, but you can trigger one immediately to test. Each run is recorded with its full output.

:::media type="image" file="run-detail-email.png"
A completed run showing the agent's steps and the tools it called. Repo-less runs have no PR link — the result is in Notion.
:::

> [!TIP]
> Turn on **Include the previous run's output as context** so each morning's digest can reference what it flagged yesterday — "still no reply on the invoice thread."

## Ideas to adapt

- **Standup prep:** summarize yesterday's merged PRs and open issues into a Notion or Slack post.
- **Calendar brief:** read today's calendar and draft a plan for the day.
- **Support triage:** read a shared inbox and file each message under the right label with a suggested response.

## Next

- React to events instead of a schedule → [Issue → pull request](#/issue-to-pr)
- The tools that make this possible → [MCP servers](#/mcp)
- The full Jobs reference → [Jobs](#/jobs)
