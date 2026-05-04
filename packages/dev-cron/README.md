# @upstream/dev-cron

Local development simulator for Vercel cron jobs.

Reads cron configuration from `vercel.json` and runs the endpoints locally on the configured schedule.

## Usage

From the package directory:

```bash
npm run dev
```

Or from the repo root (if configured):

```bash
npm run dev:cron
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | Base URL for the dev server |
| `CRON_SECRET` | `dev-secret` | Bearer token for cron endpoint auth |
| `VERCEL_JSON` | `./vercel.json` | Path to vercel.json |

## Example Output

```
╔═══════════════════════════════════════╗
║       Dev Cron Simulator              ║
╚═══════════════════════════════════════╝

Base URL: http://localhost:3000
Cron Secret: dev-****

Loading config from: /path/to/vercel.json

Found 2 cron job(s):

  /api/cron/dispatch-scheduled-jobs
    Schedule: * * * * *
    Interval: 1m
  /api/cron/agent-monitor
    Schedule: */2 * * * *
    Interval: 2m

─────────────────────────────────────────
Press Ctrl+C to stop

[2025-05-04T12:00:00.000Z] ✓ /api/cron/dispatch-scheduled-jobs (200, 45ms)
  {"processed":0,"results":[]}
[2025-05-04T12:00:00.000Z] ✓ /api/cron/agent-monitor (200, 32ms)
  {"processed":1,"results":[{"chatId":"abc","action":"refreshed"}]}
```

## Supported Cron Expressions

This is a simplified parser for development purposes:

| Expression | Interval |
|------------|----------|
| `* * * * *` | Every minute |
| `*/2 * * * *` | Every 2 minutes |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 */2 * * *` | Every 2 hours |

Complex expressions (specific times, day-of-week, etc.) default to 1 minute for dev.
