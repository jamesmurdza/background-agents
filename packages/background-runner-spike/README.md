# background-runner-spike

> Throwaway experiment. If a strategy wins, it graduates into a real package.

Compares two ways to run a **long-running process in a Daytona sandbox** and
observe it from a **cold caller** (a serverless function that starts the
command, disappears, and reconnects later with only a small serializable
handle):

| Strategy | File | How it works |
|----------|------|--------------|
| **Option C** — nohup + files | `src/file-runner.ts` | `setsid` the command in its own process group; combined output → a log file; real `$?` → a `.exit` file. Reads `tail -c +N` from a byte cursor, so each reconnect transfers **only new bytes**. |
| **Option A** — Daytona session API | `src/session-runner.ts` | `executeSessionCommand({ runAsync: true })`; the daemon supervises and buffers. Exit code from `getSessionCommand`. Logs are **full-dump only**, so incremental reads slice client-side and re-fetch the whole log each poll. |

Both implement one interface (`src/types.ts`), so the cold-reconnect harness
(`src/harness.ts`) drives them identically. Every read in the harness is a
genuine reconnect: a fresh `daytona.get()` connection, a fresh runner, and the
handle rehydrated from JSON.

## What it measures

- **Correctness:** incremental lines stitched across many reconnects equal a
  full replay-from-zero, with no duplicates or gaps; the real exit code is
  reported.
- **Cost:** `bytesFetched` per reconnect — flat for files (only new bytes),
  growing for the session API (whole log each poll). This is the O(n) vs
  O(n²) trade-off, made visible.

## Run

```bash
# Needs DAYTONA_API_KEY in the environment.

# Side-by-side demo (creates one sandbox, runs both, prints a comparison):
npm run demo -w @background-agents/background-runner-spike

# Integration tests (each test creates + deletes its own fresh sandbox):
npm test -w @background-agents/background-runner-spike
```

Tests skip automatically when `DAYTONA_API_KEY` is unset.
