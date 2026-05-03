# Agent Keepalive - Design Plan

## Problem

When the browser closes, agents can timeout and get killed:

1. User closes browser tab
2. SSE stream stops polling
3. No more activity signals to Daytona
4. Daytona auto-stops sandbox after inactivity period
5. Agent process killed mid-execution

## Solution

Server-side cron that keeps sandboxes alive for running agents, with timeouts to prevent runaway jobs.

---

## Configuration

| Setting | Value |
|---------|-------|
| Daytona autoStopInterval | 5 minutes (reduced from 10) |
| Cron interval | Every 2 minutes |
| Inactivity timeout | 10 minutes (no browser activity) |
| Hard timeout | 25 minutes (absolute max) |
| Keepalive method | `sandbox.refreshActivity()` |

---

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                         TIMELINE                              │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  0 min    User sends message, agent starts                    │
│           lastActiveAt = now                                  │
│                                                               │
│  2 min    Browser open, SSE polling                           │
│           lastActiveAt updated on reconnects                  │
│                                                               │
│  5 min    User closes browser                                 │
│           SSE stops, no more lastActiveAt updates             │
│                                                               │
│  6 min    Cron runs, sees chat.status = "running"             │
│           lastActiveAt = 5 min ago (< 10 min) ✓               │
│           totalRunTime = 6 min (< 25 min) ✓                   │
│           → sandbox.refreshActivity()                         │
│                                                               │
│  8 min    Cron runs again                                     │
│           lastActiveAt = 5 min ago (< 10 min) ✓               │
│           → sandbox.refreshActivity()                         │
│                                                               │
│  ... agent completes at 12 min, stream finalizes ...          │
│                                                               │
│  --- OR if user never returns ---                             │
│                                                               │
│  16 min   Cron runs                                           │
│           lastActiveAt = 5 min ago (11 min > 10 min) ✗        │
│           → STOP AGENT (inactivity timeout)                   │
│                                                               │
│  --- OR hard timeout ---                                      │
│                                                               │
│  26 min   Cron runs                                           │
│           totalRunTime = 26 min (> 25 min) ✗                  │
│           → STOP AGENT (hard timeout)                         │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation

### 1. Update Sandbox Creation

```typescript
// lib/sandbox.ts
const sandbox = await daytona.create({
  name: generateSandboxName(userId),
  snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
  autoStopInterval: 5,  // Changed from 10
  public: true,
  labels: { ... },
})
```

### 2. New Cron Endpoint

`GET /api/cron/keepalive-agents`

```typescript
import { Daytona } from "@daytonaio/sdk"
import { differenceInMinutes } from "date-fns"
import { prisma } from "@/lib/db/prisma"

const INACTIVITY_TIMEOUT_MINUTES = 10
const HARD_TIMEOUT_MINUTES = 25

export async function GET(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }

  const now = new Date()
  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY! })

  // Find all running chats
  const runningChats = await prisma.chat.findMany({
    where: {
      status: "running",
      sandboxId: { not: null },
      backgroundSessionId: { not: null }
    },
    include: {
      messages: {
        orderBy: { timestamp: "desc" },
        take: 1,
        where: { role: "user" }
      }
    }
  })

  const results = []

  for (const chat of runningChats) {
    // Get run start time from last user message
    const runStartedAt = chat.messages[0]?.createdAt ?? chat.lastActiveAt
    const totalMinutes = differenceInMinutes(now, runStartedAt)
    const minutesSinceActive = differenceInMinutes(now, chat.lastActiveAt)

    // Hard timeout: 25 minutes max
    if (totalMinutes > HARD_TIMEOUT_MINUTES) {
      await stopAgent(chat, daytona, "Run exceeded 25 minute limit")
      results.push({ chatId: chat.id, action: "stopped", reason: "hard_timeout" })
      continue
    }

    // Inactivity timeout: 10 minutes since last browser activity
    if (minutesSinceActive > INACTIVITY_TIMEOUT_MINUTES) {
      await stopAgent(chat, daytona, "No activity for 10 minutes")
      results.push({ chatId: chat.id, action: "stopped", reason: "inactivity" })
      continue
    }

    // Still valid — refresh sandbox activity
    try {
      const sandbox = await daytona.get(chat.sandboxId!)
      await sandbox.refreshActivity()
      results.push({ chatId: chat.id, action: "refreshed" })
    } catch (err) {
      console.error(`[keepalive] Failed to refresh sandbox ${chat.sandboxId}:`, err)
      results.push({ chatId: chat.id, action: "error", error: String(err) })
    }
  }

  return Response.json({ processed: results.length, results })
}

async function stopAgent(
  chat: { id: string; sandboxId: string | null; backgroundSessionId: string | null },
  daytona: Daytona,
  reason: string
) {
  try {
    // Kill the agent process
    if (chat.sandboxId && chat.backgroundSessionId) {
      const sandbox = await daytona.get(chat.sandboxId)
      // Kill by session ID pattern
      await sandbox.process.executeCommand(
        `pkill -f "codeagent-${chat.backgroundSessionId}" 2>/dev/null || true`
      )
    }
  } catch (err) {
    console.error(`[keepalive] Failed to kill agent:`, err)
  }

  // Update chat status
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      status: "error",
      backgroundSessionId: null
    }
  })

  // Optionally: create an error message in the chat
  await prisma.message.create({
    data: {
      chatId: chat.id,
      role: "assistant",
      content: `Agent stopped: ${reason}`,
      timestamp: BigInt(Date.now()),
      isError: true
    }
  })
}
```

### 3. Vercel Cron Config

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/keepalive-agents",
      "schedule": "*/2 * * * *"
    }
  ]
}
```

### 4. Update lastActiveAt on Browser Activity

Update `lastActiveAt` when:
- User sends a message (already happens)
- Browser reconnects to SSE stream
- User opens the chat

```typescript
// In SSE stream reconnection
await prisma.chat.update({
  where: { id: chatId },
  data: { lastActiveAt: new Date() }
})
```

---

## Why `refreshActivity()` Instead of `executeCommand()`

From [Daytona SDK docs](https://www.daytona.io/docs/en/typescript-sdk/sandbox/):

> **`refreshActivity()`** - "Refreshes the sandbox activity to reset the timer for automated lifecycle management actions."

This is the official way to reset the inactivity timer. `executeCommand()` runs a command but may not reset Daytona's internal activity tracking.

---

## Summary

| Component | Purpose |
|-----------|---------|
| `autoStopInterval: 5` | Daytona stops sandbox after 5 min inactivity |
| `sandbox.refreshActivity()` | Resets the 5 min timer |
| Cron every 2 min | Calls refreshActivity for running agents |
| `lastActiveAt` | Tracks when user last had browser open |
| 10 min inactivity timeout | Stop if user hasn't looked in 10 min |
| 25 min hard timeout | Stop no matter what after 25 min |
