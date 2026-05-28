# @background-agents/dev-cron

Local development simulator for Vercel cron jobs.

Reads cron configuration from `vercel.json` and runs the endpoints locally on the configured schedule.

## Usage

From the package directory:

```bash
npm run dev
```

Or from the repo root:

```bash
npm run dev:cron
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:4000` | Base URL for the dev server |
| `CRON_SECRET` | (none) | Bearer token for cron endpoint auth |
| `VERCEL_JSON` | `./vercel.json` | Path to vercel.json |

## Example Output

```
╔═══════════════════════════════════════╗
║       Dev Cron Simulator              ║
╚═══════════════════════════════════════╝

Base URL: http://localhost:4000
Cron Secret: (none)

Loading config from: /path/to/vercel.json

Found 3 cron job(s):

  /api/cron/refresh-claude-creds
    Schedule: 0 * * * *
    Interval: 1h
  /api/cron/agent-lifecycle
    Schedule: * * * * *
    Interval: 1m
  /api/cron/rebuild-snapshot
    Schedule: 0 3 * * 0
    Interval: 1m

─────────────────────────────────────────
Press Ctrl+C to stop

[2026-01-15T12:00:00.000Z] ✓ /api/cron/refresh-claude-creds (200, 45ms)
  {"refreshed":0}
[2026-01-15T12:00:00.000Z] ✓ /api/cron/agent-lifecycle (200, 32ms)
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
