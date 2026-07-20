# Agent Battle

**Goal:** send the *same* prompt to several different agents in parallel — in this run, **Claude Code, Kimi Code, and OpenCode** all building the same Snake game — then compare how each one solves it. A great way to pick the right agent for a kind of task.

This showcases multi-agent support, per-chat model selection, and branching one chat into parallel attempts.

:::media type="video" file="multi-agent-final.mp4" duration="~2 min"
One prompt — "build Snake" — branched to three agents (Claude Code, Kimi Code, OpenCode) running side by side. Watch them diverge, then compare the results and pick a winner.
:::

## Prerequisites

- Credentials for each agent you want to enter — a provider API key, a subscription, or a [custom endpoint](#/custom-endpoints).
- A small, well-defined task with a clear "good" outcome.

## Step 1 — Pick a task with a clear finish line

Battles are only useful when you can judge the result. A self-contained mini-app like Snake is ideal — you can *play* each result and see which feels best. Other good candidates:

- "Add input validation and tests to this function."
- "Refactor this component to remove the duplicated state."
- "Write a regex that parses these log lines and a test for it."

## Step 2 — Branch the chat, one agent per branch

Start a chat, then create a **child branch** for each contender and select a different agent in each — Claude Code on one, Kimi Code on another, OpenCode on a third. Each branch is isolated, so the three attempts never collide.

:::media type="image" file="branch-agents.png"
One chat branched into three, each child running a different agent on the same task.
:::

## Step 3 — Send the identical prompt

Paste the same prompt into each branch. Keep the wording byte-for-byte identical so you're comparing agents, not prompts.

```text
Build a browser version of Snake in a single self-contained index.html using
vanilla JavaScript and a <canvas> — no build step, no dependencies. Arrow keys
to steer, a score counter, and a game-over screen with restart. Then start a
static server so I can play it.
```

## Step 4 — Compare

Judge on what matters to you:

| Criterion | What to look for |
|-----------|------------------|
| Correctness | Does it actually run and play without bugs? |
| Minimalism | Did it change only what was needed? |
| Reasoning | Did it explain its approach clearly? |
| Speed | How long until a usable result? |

Each branch is on its own Git branch, so you can open all three PRs and diff them side by side.

> [!TIP]
> Run the same battle on a few task *types* — a bug fix, a refactor, a green-field build. Agents rarely win every category, and you'll end up with a personal cheat sheet of which agent to reach for when.

## Next

- Enter a self-hosted or proxied model into the battle → [Custom endpoints](#/custom-endpoints)
- Level the field by giving every agent the same tools → [MCP servers](#/mcp)
