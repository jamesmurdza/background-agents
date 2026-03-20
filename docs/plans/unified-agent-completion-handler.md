# Unified Agent Completion Handler

## Summary

Create a single API endpoint (`/api/agent/completion`) that handles all post-execution logic when an agent run finishes. This endpoint will:
- Use a lockfile on the sandbox to prevent duplicate processing
- Bypass stale locks (>60 seconds old)
- Handle auto-commit and push
- Check and trigger loop mode continuation
- Update branch status (stop spinner)

## Files to Create

### `/home/daytona/sandboxed-agents/app/api/agent/completion/route.ts` (NEW)

Main unified completion handler endpoint that:

1. **Accepts requests from both client and cron** via dual authentication
2. **Acquires lockfile** at `/home/daytona/.agent_completion.lock`
3. **Runs auto-commit-push** (moved from client-side `detectAndShowCommits`)
4. **Checks loop continuation** conditions
5. **Updates branch status** to "idle" or "running" (for loop)
6. **Releases lockfile** when done

**Request body:**
```typescript
{
  branchId: string
  executionId: string
  status: "completed" | "error"
  content?: string  // for loop finished check
  source: "client" | "cron"
}
```

**Response:**
```typescript
{
  success: boolean
  handled: boolean      // false if lock prevented processing
  loopContinued: boolean
  commitInfo?: { committed: boolean, pushed: boolean, commitMessage?: string }
}
```

## Files to Modify

### `/home/daytona/sandboxed-agents/lib/constants.ts`

Add lockfile path constant:
```typescript
PATHS = {
  // ... existing paths
  AGENT_COMPLETION_LOCK: "/home/daytona/.agent_completion.lock",
}
```

### `/home/daytona/sandboxed-agents/lib/api-helpers.ts`

Add dual auth helper for cron + user auth:
```typescript
export async function requireCompletionAuth(req: Request): Promise<AuthResult | Response> {
  // Check cron secret first
  const authHeader = req.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    if (token === process.env.CRON_SECRET) {
      return { userId: "SYSTEM_CRON" }
    }
  }
  // Fall back to user auth
  return requireAuth()
}
```

### `/home/daytona/sandboxed-agents/components/chat/hooks/useExecutionPolling.ts`

Replace completion logic (lines 448-505) with API call:

**Before:**
```typescript
await detectAndShowCommits(true)
const shouldContinueLoop = ...
if (shouldContinueLoop) { ... }
else { onUpdateBranch(... status: "idle") }
```

**After:**
```typescript
// Call unified completion handler
const res = await fetch("/api/agent/completion", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    branchId: completedBranchId,
    executionId: currentExecutionIdRef.current || execution.id,
    status: data.status === EXECUTION_STATUS.COMPLETED ? "completed" : "error",
    content: data.content,
    source: "client",
  }),
})
const result = await res.json()

if (result.handled) {
  // Show commits in chat (without re-running auto-commit)
  if (result.commitInfo?.committed) {
    await detectAndShowCommits(false)
  }

  if (!result.loopContinued) {
    // Normal completion
    onUpdateBranch(completedBranchId, { status: "idle", ...loopUpdates })
    playCompletionSound()
  }
  // If loopContinued, server already started new execution
}
```

Also update `detectAndShowCommits` to skip auto-commit when `runAutoCommit=false`.

### `/home/daytona/sandboxed-agents/app/api/cron/loop-check/route.ts`

Simplify to call completion API instead of duplicating logic:

```typescript
export async function GET(req: Request) {
  if (!verifyCronSecret(req)) return unauthorized()

  // Find completed executions eligible for processing
  const fifteenSecondsAgo = new Date(Date.now() - 15 * 1000)
  const executions = await prisma.agentExecution.findMany({
    where: {
      status: EXECUTION_STATUS.COMPLETED,
      completedAt: { lt: fifteenSecondsAgo },
      message: { branch: { loopEnabled: true, status: "idle" } }
    },
    include: { message: { include: { branch: true } } },
    take: 10,
  })

  let continued = 0
  for (const execution of executions) {
    const res = await fetch(`${process.env.NEXTAUTH_URL}/api/agent/completion`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.CRON_SECRET}`,
      },
      body: JSON.stringify({
        branchId: execution.message.branchId,
        executionId: execution.id,
        status: "completed",
        content: execution.message.content,
        source: "cron",
      }),
    })
    const data = await res.json()
    if (data.handled && data.loopContinued) continued++
  }

  return Response.json({ success: true, continued })
}
```

## Lockfile Implementation

```typescript
const STALE_LOCK_TIMEOUT_MS = 60_000  // 60 seconds
const lockPath = PATHS.AGENT_COMPLETION_LOCK

async function acquireLock(sandbox, executionId, source) {
  // Check existing lock
  const result = await sandbox.process.executeCommand(
    `cat ${lockPath} 2>/dev/null || echo "NO_LOCK"`
  )

  if (result.result.trim() !== "NO_LOCK") {
    const lockData = JSON.parse(result.result.trim())

    // Same execution = already being handled
    if (lockData.executionId === executionId) {
      return { acquired: false, reason: "same_execution" }
    }

    // Check if stale (>60 seconds)
    if (Date.now() - lockData.lockedAt < STALE_LOCK_TIMEOUT_MS) {
      return { acquired: false, reason: "locked" }
    }
    // Stale lock - proceed to overwrite
  }

  // Acquire lock atomically
  const lockContent = JSON.stringify({ executionId, lockedAt: Date.now(), source })
  await sandbox.process.executeCommand(
    `echo '${lockContent}' > ${lockPath}.tmp && mv ${lockPath}.tmp ${lockPath}`
  )

  // Verify we got it
  const verify = await sandbox.process.executeCommand(`cat ${lockPath}`)
  const verified = JSON.parse(verify.result.trim())
  return { acquired: verified.executionId === executionId }
}

async function releaseLock(sandbox) {
  await sandbox.process.executeCommand(`rm -f ${lockPath}`)
}
```

## Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Execution Completes                 │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     Client Polling                    Cron Job (15s delay)
     (useExecutionPolling)             (loop-check/route.ts)
              │                               │
              └───────────────┬───────────────┘
                              ▼
              POST /api/agent/completion
                              │
                              ▼
                    ┌─────────────────┐
                    │  Acquire Lock   │
                    │  on sandbox     │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ Lock acquired?              │
              │ (or bypassed if >60s stale) │
              └──────────────┬──────────────┘
                    NO       │      YES
                    │        │        │
                    ▼        │        ▼
           Return {          │   Auto-commit-push
           handled: false    │        │
           }                 │        ▼
                             │   Check loop conditions
                             │        │
                             │   ┌────┴────┐
                             │   │Continue?│
                             │   └────┬────┘
                             │  YES   │   NO
                             │   │    │    │
                             │   ▼    │    ▼
                             │ Trigger│  Set status
                             │ loop   │  to "idle"
                             │ start  │    │
                             │   │    │    │
                             └───┴────┴────┘
                                      │
                                      ▼
                              Release Lock
                                      │
                                      ▼
                              Return response
```

## Edge Cases

| Case | Solution |
|------|----------|
| Both client and cron call simultaneously | Lockfile ensures only one processes; other gets `handled: false` |
| Process crashes holding lock | 60-second stale timeout allows recovery |
| Sandbox not running | `ensureSandboxStarted()` before lock operations |
| Auto-commit fails | Continue with status update; return error in `commitInfo` |
| Loop continuation fails | Reset branch to idle, log error |
| GitHub token expired | Push fails gracefully; `pushed: false` |

## Verification

1. **Unit test**: Call completion endpoint with mock sandbox
2. **Integration test**:
   - Start agent execution
   - Wait for completion
   - Verify auto-commit happened
   - Verify loop continuation if enabled
   - Verify status changed to idle if not looping
3. **Race condition test**:
   - Call completion endpoint twice rapidly
   - Verify only one processes (other gets `handled: false`)
4. **Stale lock test**:
   - Create lock with timestamp >60s ago
   - Call completion endpoint
   - Verify it bypasses the stale lock
