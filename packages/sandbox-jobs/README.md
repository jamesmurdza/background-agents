# @background-agents/sandbox-jobs

Run, observe, and reconnect to **long-running shell processes** in a Daytona
sandbox — using the sandbox filesystem as the durable source of truth.

The problem it solves: a sandbox's `executeCommand` is request/response and
short-lived, but a real job (an agent run, a build, a test suite) can run for
minutes. This package detaches the process inside the sandbox and represents the
entire run as files, so a **cold caller** — a serverless function, a restarted
server, a different process — can reattach by id and read output incrementally
without ever holding a connection open.

## Model

One job = one process = one directory:

```
<root>/<jobId>/
  meta.json     { jobId, pgid, processName, outputFile, exitFile, dir, createdAt, version, commandFingerprint }
  output.log    combined stdout+stderr, byte-exact, append-only
  exit          integer $?, also written after confirmed cancellation
  command-exit  wrapper-only foreground exit code (atomic publication)
  cancelling    retain full descendant liveness during explicit cancellation
  launch.lock   shared by launch and abort
  aborted       permanent no-future-launch marker for this attempt
```

- **Detached + fully reapable.** Launched with `setsid` and placed in its own
  cgroup-v2. `cancel()` writes the cgroup's `cgroup.kill`, which SIGKILLs
  *every* descendant — including a child that re-sessions itself with `setsid()`
  (e.g. a daemonized MCP server) and so escapes the process group. A
  process-group kill alone misses those and leaks them. Requires cgroup-v2 and
  privilege to create a cgroup (the sandbox image grants this via `sudo`).
- **Real exit codes.** The wrapper records the true `$?`; completion is never
  guessed. A process killed before it could write `$?` (SIGKILL/OOM) is detected
  as `crashed` via process-group liveness.
- **Incremental, UTF-8-safe reads.** `read(handle, cursor)` returns only bytes
  after the cursor, truncated to the last complete line — so the cursor never
  splits a multi-byte character and you never re-read the whole log.
- **Cold reconnect.** Everything needed to reattach is the serializable
  `JobHandle` + an integer cursor, or just the job id via `attach()`.
- **Recoverable startup.** Pass a stable `jobId` before calling `start()`.
  The detached wrapper saves its identity before running the command. A retry
  with that id reattaches instead of running the command again, including when
  the original response was lost. Reusing an id with a different command,
  working directory, or timeout is rejected rather than pretending new work
  ran. `abort(jobId, root)` prevents a delayed
  launcher from starting and confirms any existing process stopped. This also
  works for an attempt that never launched. Keep the attempt's files until no
  delayed caller can retry it; deleting its abort marker removes that fence.

These operations require `flock` in addition to `setsid` and the cgroup-v2
permissions described above. Missing or unreadable status is an error, not a
successful cancellation. An `exit` file alone does not make a job terminal while
an owned process remains alive.

A normally completed foreground command can leave background services (such as a
website preview) running. Once its wrapper is gone and `command-exit` agrees with
`exit`, `status()` and `read()` report the command as exited without killing those
services. The populated cgroup remains owned by that job: explicit `cancel()`
still reaps every descendant, while cancelling a later job cannot kill it.
A provider's end event, a lone exit file, or an unknown/crashed wrapper is not
completion proof. Cancellation records `cancelling` before signalling processes,
so it continues to require full process-group/cgroup termination even when the
foreground command exits during Stop.

Jobs launched by older versions lack `command-exit`; they retain the conservative
all-descendant check. An already-stuck legacy turn still needs Stop and a preview
restart once. No database migration or provider-specific process-name matching
is needed.

## Why not Daytona's session API (`executeSessionCommand`)?

Daytona ships a native way to run a detached command: `createSession` +
`executeSessionCommand({ runAsync: true })`, then `getSessionCommand` /
`getSessionCommandLogs`. It looks like it should replace this package — the
daemon supervises the process and even returns a real exit code. We evaluated
it directly; for the **cold-serverless-poller** use case (a function that starts
a job, dies, and reconnects later to stream output into a DB) the file approach
wins on the things that actually bite:

| | This package (files) | `executeSessionCommand` |
|---|---|---|
| **Incremental reads** | byte-offset `tail` → only new bytes, **O(n)** over a run | `getSessionCommandLogs` has **no offset param**: full-dump every poll (**O(n²)**), *or* a streaming callback that forces a held-open connection |
| **Connectionless polling** | any cold caller reads the filesystem; nothing to keep alive | the streaming variant needs a live socket; the dump variant re-sends everything |
| **Output fidelity** | `output.log` is **byte-exact**, so a byte cursor is reliable | the log stream is wrapped in control-byte framing (e.g. `\x01` markers) — not byte-exact, which breaks offset cursors |
| **Cancellation** | `cgroup.kill` reaps the whole job cgroup, incl. `setsid()` escapees | no documented kill for an async session command — you shell out to `pkill` anyway |
| **Lifecycle to manage** | none — a dead process just leaves files; cleanup is `rm -rf <dir>` | a **session** outlives the command and must be torn down; deleting a live session reaps the process (a real footgun), and sessions accumulate |
| **Isolation** | each job is its own process, dir, and cursor | a session is a **stateful shell** — env/cwd bleed across commands |
| **Full-transcript retention** | the whole log until the disk fills | the daemon's log buffer may be capped (undocumented), which would break replay-from-zero |
| **Backend surface** | only needs `executeCommand` — the most basic primitive | tied to the full session/command API |

Note one thing it does **not** beat the session API on: exit codes.
`getSessionCommand` returns a real `exitCode` too. The exit-code win here is over
the older `nohup` + `.done`-sentinel approach this package replaces, not over the
session API.

**When the session API is the better choice:** when you *want* Daytona to own
process supervision (server-side observability), or when you have a long-lived
server holding a socket and want live push rather than polling — e.g. an
interactive terminal/PTY. That's a different shape than "reliably get every line
and the exit code into a database from an intermittent caller," which is what
this package is for.

## Usage

```ts
import { createSandboxJobs } from "@background-agents/sandbox-jobs"

const jobs = createSandboxJobs(sandbox) // a @daytonaio/sdk Sandbox

const handle = await jobs.start({
  command: `for i in $(seq 1 100); do echo "tick $i"; sleep 1; done`,
  cwd: "/home/daytona/project",
  env: { FOO: "bar" },
  timeoutSeconds: 600, // optional hard limit (coreutils `timeout`)
})

// Poll incrementally (cold-start safe — rebuild `jobs`/`handle` each time):
let cursor = 0
for (;;) {
  const r = await jobs.read(handle, cursor)
  cursor = r.cursor
  process.stdout.write(r.raw)
  if (r.status.state !== "running") {
    console.log("done", r.status) // { state: "exited", exitCode: 0, alive: false }
    break
  }
}

// Or reattach later from just the id:
const reattached = await jobs.attach(handle.jobId)
```

For recoverable launch, save an attempt id with your application state first:

```ts
await jobs.start({ jobId: savedAttemptId, command: "your-command" })
// If launch throws, its outcome may be unknown. Retain ownership and inspect
// that same id, or fence/cancel it before allowing a replacement attempt:
await jobs.abort(savedAttemptId)
```

Without an explicit `jobId`, `start()` still generates a fresh id. `attach()`
returns `null` only for an absent record; corrupt records and failed reads
throw. Custom `SandboxJobs` implementations must provide `abort()` and
`isAborted()` with the same launch-fencing guarantees.

## Tests

```bash
npm run typecheck
npm run test -w @background-agents/sandbox-jobs   # pure unit tests, instant
DAYTONA_API_KEY=... npm run test -w @background-agents/sandbox-jobs  # + integration (creates a sandbox)
```
