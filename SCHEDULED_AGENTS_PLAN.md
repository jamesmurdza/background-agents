# Scheduled Agents - Design Plan

## Overview

Agents that run automatically on a schedule, execute a prompt against a repo, and create PRs if there are commits.

---

## UI Design

### Creation
- Clock icon (⏰) in prompt field, left of agent selector
- Click opens modal with: repo, branch, agent, model, interval, prompt, auto-PR toggle
- Current chat context pre-fills defaults

### Sidebar
- Single item: "⏰ Scheduled Jobs"
- Click opens table view

### Table View

| NAME | REPO | EVERY | LAST RUN |
|------|------|-------|----------|
| Dep updates | acme/app | 6h | ✓ 2h ago PR #142 |
| Code audit | acme/lib | 1w | ✓ 3d ago no changes |
| Security scan | acme/api | 1d | ✗ failed |

- Click row → opens chat view for that job
- Row menu (⋮): Edit, Run Now, Delete

### Chat View
- **Header**: Title (left), timestamp dropdown (right)
- **Body**: Messages from that run (same as regular chat)
- **Timestamp dropdown**: Lists all past runs with status (✓/✗), select to view that run
- **Navigation**: Click "Scheduled Jobs" in sidebar to go back to table

### Edit
- From table row menu only
- Same form as creation, pre-filled

### Interval Picker
- Presets: hourly, daily, weekly (as shortcuts)
- Custom: "Every X [hours/days/weeks]" picker

### Empty State
- Text: "No scheduled jobs yet"
- Button: "Create your first job"

---

## User Flows

### Flow 1: Create a Scheduled Job

1. User is in a chat (or empty prompt)
2. Clicks ⏰ icon next to agent selector
3. Modal opens with form
4. Clicks "Create"
5. **Navigates to Scheduled Jobs table, new job highlighted**

### Flow 2: View Scheduled Jobs

1. User clicks "⏰ Scheduled Jobs" in sidebar
2. Table appears showing all jobs with last run status
3. User scans to see what's running, what failed, recent PRs

### Flow 3: View a Specific Run

1. From table, user clicks a job row
2. Chat view opens showing latest run's messages
3. Header shows: job name (left), run timestamp (right)
4. User reads agent output, sees commits made, PR created

### Flow 4: View Past Runs

1. User is in a job's chat view
2. Clicks timestamp dropdown (top right)
3. Dropdown shows list of all runs with ✓/✗ status
4. User selects an older run
5. Chat view updates to show that run's messages

### Flow 5: Edit a Job

1. From table, user clicks row menu (⋮) → Edit
2. Same modal as create, pre-filled with current config
3. User modifies interval, prompt, etc.
4. Clicks "Save"
5. **Returns to Scheduled Jobs table**

### Flow 6: Delete a Job

1. From table, user clicks row menu (⋮) → Delete
2. Confirmation prompt
3. Job and run history removed

### Flow 7: Run Now (Manual Trigger)

1. From table, user clicks row menu (⋮) → Run Now
2. Job executes immediately (outside normal schedule)
3. User can click into job to watch progress in chat view

---

## Decisions

| Question | Decision |
|----------|----------|
| Edit access point | Table row menu only |
| Run Now access | Table row menu only |
| Pause/Resume | Not supported - delete and recreate instead |
| Empty state | Text + "Create your first job" button |
| Interval picker | Presets (hourly/daily/weekly) + custom "every X hours/days/weeks" |
| Sandbox reuse | Fresh sandbox every run |
| Concurrent runs | Skip if previous run still running |
| Run timeout | 20 minutes |
| Run retention | Last 50 runs per job |
| User limits | Max 5 jobs per user |
| Credentials expire | Run fails, job stays enabled, retry next interval |
| Repo deleted | Run fails, job auto-disables after 3 consecutive failures |
| Branch deleted | Run fails, job auto-disables after 3 consecutive failures |

---

## Database Schema

### New Tables

```prisma
model ScheduledJob {
  id            String   @id @default(cuid())
  userId        String

  // Config
  name          String
  prompt        String   @db.Text
  repo          String
  baseBranch    String
  agent         String
  model         String?

  // Schedule
  intervalMinutes Int              // e.g., 360 = every 6 hours
  enabled       Boolean  @default(true)
  nextRunAt     DateTime

  // Auto-PR
  autoPR        Boolean  @default(true)

  // Failure tracking
  consecutiveFailures Int @default(0)

  // Timestamps
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  runs ScheduledJobRun[]

  @@index([userId])
  @@index([enabled, nextRunAt])
}

model ScheduledJobRun {
  id          String    @id @default(cuid())
  jobId       String

  // Execution
  status      String    // "pending" | "running" | "completed" | "error"
  startedAt   DateTime  @default(now())
  completedAt DateTime?

  // Results
  sandboxId   String?
  backgroundSessionId String?
  branch      String?
  commitCount Int       @default(0)
  prUrl       String?
  prNumber    Int?
  error       String?   @db.Text

  // Link to chat for full message history
  chatId      String?   @unique
  chat        Chat?     @relation(fields: [chatId], references: [id])

  job ScheduledJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId, startedAt])
}
```

### Modifications to Existing Tables

```prisma
model Chat {
  // ... existing fields ...

  // Hide scheduled run chats from sidebar
  isScheduledRun  Boolean  @default(false)

  // Link back to run
  scheduledJobRun ScheduledJobRun?
}
```

Chats created for scheduled runs are hidden from the main sidebar (filtered by `isScheduledRun: false`). They're only accessible via the Scheduled Jobs table.

---

## API Endpoints

### CRUD

```
GET    /api/scheduled-jobs                  # List user's jobs
POST   /api/scheduled-jobs                  # Create job (max 5)
GET    /api/scheduled-jobs/[id]             # Get job with recent runs
PATCH  /api/scheduled-jobs/[id]             # Update job config
DELETE /api/scheduled-jobs/[id]             # Delete job + runs
```

### Actions

```
POST   /api/scheduled-jobs/[id]/run         # Trigger immediate run
```

### Run History

```
GET    /api/scheduled-jobs/[id]/runs        # List runs (last 50)
GET    /api/scheduled-jobs/[id]/runs/[runId] # Get run with messages
```

---

## Cron Implementation

### Approach: Vercel Cron + Database Polling

Two cron jobs running every minute:

1. **Dispatcher**: Finds due jobs, starts execution
2. **Completion Checker**: Polls running jobs, finalizes when done (+ timeout check)

### Cron 1: Job Dispatcher

`GET /api/cron/dispatch-scheduled-jobs`

```typescript
async function handler() {
  // Find due jobs
  const jobs = await prisma.scheduledJob.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: new Date() },
      // Not already running
      runs: { none: { status: "running" } }
    }
  })

  for (const job of jobs) {
    // Create run record (claims the job)
    const run = await prisma.scheduledJobRun.create({
      data: { jobId: job.id, status: "running" }
    })

    // Update next run time
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { nextRunAt: addMinutes(new Date(), job.intervalMinutes) }
    })

    // Start execution (fire-and-forget)
    await startJobExecution(job, run)
  }
}
```

### Cron 2: Completion Checker

`GET /api/cron/check-scheduled-runs`

```typescript
const RUN_TIMEOUT_MINUTES = 20

async function handler() {
  const runs = await prisma.scheduledJobRun.findMany({
    where: { status: "running" },
    include: { job: true }
  })

  for (const run of runs) {
    // Check for timeout
    const runningMinutes = differenceInMinutes(new Date(), run.startedAt)
    if (runningMinutes > RUN_TIMEOUT_MINUTES) {
      await failRun(run, "Run timed out after 20 minutes")
      continue
    }

    const snapshot = await snapshotBackgroundAgent(run.sandboxId, run.backgroundSessionId)

    if (snapshot.status === "completed") {
      await finalizeRun(run, snapshot)
    } else if (snapshot.status === "error") {
      await failRun(run, snapshot.error)
    }
    // else still running, check again next minute
  }
}

async function failRun(run: ScheduledJobRun, error: string) {
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: { status: "error", completedAt: new Date(), error }
  })

  // Track consecutive failures, auto-disable after 3
  const failures = run.job.consecutiveFailures + 1
  await prisma.scheduledJob.update({
    where: { id: run.jobId },
    data: {
      consecutiveFailures: failures,
      enabled: failures < 3
    }
  })
}
```

### Vercel Config

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/dispatch-scheduled-jobs",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/check-scheduled-runs",
      "schedule": "* * * * *"
    }
  ]
}
```

---

## Job Execution Flow

```typescript
async function startJobExecution(job: ScheduledJob, run: ScheduledJobRun) {
  // 1. Create chat for this run (hidden from sidebar)
  const chat = await prisma.chat.create({
    data: {
      userId: job.userId,
      repo: job.repo,
      baseBranch: job.baseBranch,
      agent: job.agent,
      model: job.model,
      isScheduledRun: true
    }
  })

  // 2. Create fresh sandbox
  const sandbox = await createSandbox({
    repo: job.repo,
    branch: job.baseBranch
  })

  // 3. Create unique branch for this run
  const branch = `scheduled/${job.id}/${format(new Date(), "yyyyMMdd-HHmmss")}`
  await sandbox.exec(`git checkout -b ${branch}`)

  // 4. Get user credentials
  const user = await prisma.user.findUnique({ where: { id: job.userId } })
  const credentials = decrypt(user.credentials)

  // 5. Start agent session
  const session = await createBackgroundAgentSession({
    sandbox,
    agent: job.agent,
    model: job.model,
    prompt: job.prompt,
    credentials
  })

  // 6. Store session info for completion checker
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: {
      chatId: chat.id,
      sandboxId: sandbox.id,
      backgroundSessionId: session.id,
      branch
    }
  })
}
```

---

## Run Finalization

```typescript
async function finalizeRun(run: ScheduledJobRun, snapshot: AgentSnapshot) {
  const job = run.job

  // 1. Save messages to linked chat
  for (const msg of snapshot.messages) {
    await prisma.message.create({
      data: {
        chatId: run.chatId,
        role: msg.role,
        content: msg.content,
        // ... other fields
      }
    })
  }

  // 2. Count commits
  const commitCount = await getCommitCount(run.sandboxId, job.baseBranch, run.branch)

  // 3. Maybe create PR
  let prUrl, prNumber
  if (job.autoPR && commitCount > 0) {
    await pushBranch(run.sandboxId, run.branch)

    const pr = await createPR({
      repo: job.repo,
      head: run.branch,
      base: job.baseBranch,
      title: `[Scheduled] ${job.name} - ${format(run.startedAt, "MMM d")}`,
    })
    prUrl = pr.url
    prNumber = pr.number
  }

  // 4. Update run record
  await prisma.scheduledJobRun.update({
    where: { id: run.id },
    data: {
      status: "completed",
      completedAt: new Date(),
      commitCount,
      prUrl,
      prNumber
    }
  })

  // 5. Reset consecutive failures on success
  await prisma.scheduledJob.update({
    where: { id: run.jobId },
    data: { consecutiveFailures: 0 }
  })

  // 6. Prune old runs (keep last 50)
  const oldRuns = await prisma.scheduledJobRun.findMany({
    where: { jobId: run.jobId },
    orderBy: { startedAt: "desc" },
    skip: 50,
    select: { id: true, chatId: true }
  })
  if (oldRuns.length > 0) {
    await prisma.chat.deleteMany({
      where: { id: { in: oldRuns.map(r => r.chatId).filter(Boolean) } }
    })
    await prisma.scheduledJobRun.deleteMany({
      where: { id: { in: oldRuns.map(r => r.id) } }
    })
  }
}
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| `ScheduledJob` | Stores job config, schedule, next run time |
| `ScheduledJobRun` | Stores each execution's results, links to Chat |
| `Chat.isScheduledRun` | Hides scheduled run chats from sidebar |
| `/api/cron/dispatch-scheduled-jobs` | Finds due jobs, starts execution |
| `/api/cron/check-scheduled-runs` | Polls running jobs, handles timeout, finalizes |
| Clock icon in prompt | Entry point to create scheduled job |
| Scheduled Jobs sidebar item | Entry point to view/manage jobs |

## Limits

| Limit | Value |
|-------|-------|
| Max jobs per user | 5 |
| Run timeout | 20 minutes |
| Run history retention | Last 50 runs per job |
| Auto-disable threshold | 3 consecutive failures |

---

## Email Notifications (Optional)

### Overview

Email notifications via **Resend**. Only enabled if `RESEND_API_KEY` environment variable is set. Otherwise, no emails sent (silent fallback).

### When to Notify

| Event | Email? |
|-------|--------|
| Run completed with PR | ✓ Yes - link to PR |
| Run completed, no changes | No - too noisy |
| Run failed | ✓ Yes - include error |
| Job auto-disabled (3 failures) | ✓ Yes - needs attention |

### Implementation

```typescript
// lib/email.ts
import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

export async function sendScheduledJobEmail(
  to: string,
  subject: string,
  html: string
) {
  if (!resend) return // Silent skip if not configured

  await resend.emails.send({
    from: 'Background Agents <notifications@yourdomain.com>',
    to,
    subject,
    html
  })
}
```

### Email Templates

**Run Completed (with PR)**
```
Subject: [Scheduled] Dep updates created PR #142

Your scheduled job "Dep updates" completed successfully.

Repository: acme/app
Commits: 3
Pull Request: #142

[View PR]
```

**Run Failed**
```
Subject: [Scheduled] Dep updates failed

Your scheduled job "Dep updates" failed.

Repository: acme/app
Error: Sandbox timed out after 20 minutes

[View Details]
```

**Job Auto-Disabled**
```
Subject: [Scheduled] Dep updates has been disabled

Your scheduled job "Dep updates" has been automatically disabled
after 3 consecutive failures.

Last error: Repository not found

Please check your configuration and re-enable the job.

[View Job]
```

### Environment Variable

```bash
# Optional - if not set, no emails sent
RESEND_API_KEY=re_xxxxx
```

### Integration Points

Add email calls to existing functions:

```typescript
async function finalizeRun(run: ScheduledJobRun, snapshot: AgentSnapshot) {
  // ... existing code ...

  // Send email if PR was created
  if (prUrl && user.email) {
    await sendScheduledJobEmail(
      user.email,
      `[Scheduled] ${job.name} created PR #${prNumber}`,
      renderPRCreatedEmail({ job, run, prUrl, prNumber, commitCount })
    )
  }
}

async function failRun(run: ScheduledJobRun, error: string) {
  // ... existing code ...

  // Send email on failure
  if (user.email) {
    await sendScheduledJobEmail(
      user.email,
      `[Scheduled] ${job.name} failed`,
      renderFailedEmail({ job, run, error })
    )
  }

  // Extra email if job got auto-disabled
  if (failures >= 3 && user.email) {
    await sendScheduledJobEmail(
      user.email,
      `[Scheduled] ${job.name} has been disabled`,
      renderDisabledEmail({ job, error })
    )
  }
}
