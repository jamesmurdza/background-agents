# Claude Instructions

## Development

For development server instructions, see [DEVELOPMENT.md](./DEVELOPMENT.md).

## Daytona Sandbox Environment

When running inside a Daytona sandbox:

### Environment Variables
`GITHUB_PAT` and `DAYTONA_API_KEY` are already set in the environment — don't add them to `.env`. Only add local-specific config (database URL, NextAuth settings, etc.) to `.env`.

**Important:** Set `NEXTAUTH_URL` to the Daytona proxy URL (not `localhost:3000`) to avoid redirect issues:
```
NEXTAUTH_URL="https://{port}-{sandbox-id}.daytonaproxy01.net"
```

### Preview URL
The app is accessible via the Daytona proxy URL pattern:
```
https://{port}-{sandbox-id}.daytonaproxy01.net
```

The `allowedDevOrigins` wildcard (`**.daytonaproxy01.net`) in `next.config.mjs` handles this automatically.

### Running Servers
Start web servers with `nohup` so they persist:
```bash
nohup npm run dev > server.log 2>&1 &
```
