# Claude Instructions

## Starting the Development Server (Daytona Sandbox)

`GITHUB_PAT` and `DAYTONA_API_KEY` are already set in the sandbox environment.

### 1. Install PostgreSQL and Create Database

```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
sudo service postgresql start
sudo -u postgres psql -c "CREATE USER sandboxed WITH PASSWORD 'sandboxed123';"
sudo -u postgres psql -c "CREATE DATABASE sandboxed_agents OWNER sandboxed;"
```

### 2. Create Environment File

Create `packages/web/.env` with the Daytona proxy URL (replace `{sandbox-id}` with actual ID):

```bash
cat > packages/web/.env << 'EOF'
DATABASE_URL="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"
DATABASE_URL_UNPOOLED="postgresql://sandboxed:sandboxed123@localhost:5432/sandboxed_agents"
NEXTAUTH_URL="https://3000-{sandbox-id}.daytonaproxy01.net"
NEXTAUTH_SECRET="dev-secret"
GITHUB_CLIENT_ID="placeholder"
GITHUB_CLIENT_SECRET="placeholder"
ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
EOF
```

**CRITICAL:** `NEXTAUTH_URL` must be the Daytona proxy URL, not `localhost:3000`.

### 3. Install, Build, and Initialize

```bash
npm install
npm run build:sdk
cd packages/web && npx prisma db push && cd ../..
```

### 4. Start the Server

```bash
nohup npm run dev > server.log 2>&1 &
```

The app is accessible at: `https://3000-{sandbox-id}.daytonaproxy01.net`

## Testing

### SDK Unit Tests (No API Keys Required)

```bash
npm run test -w @upstream/agents
```

### SDK Integration Tests

Integration tests require real Daytona sandboxes. Tests are skipped automatically when required environment variables are missing.

```bash
# Integration tests (OpenCode subset needs only Daytona)
DAYTONA_API_KEY=dtn_... npm run test -w @upstream/agents -- tests/integration/

# Claude provider tests (requires Anthropic key)
DAYTONA_API_KEY=dtn_... ANTHROPIC_API_KEY=sk-ant-... npm run test -w @upstream/agents -- tests/integration/

# Run all SDK tests including integration
DAYTONA_API_KEY=dtn_... ANTHROPIC_API_KEY=sk-ant-... npm run test -w @upstream/agents
```

Web app E2E (Playwright) is documented in the root **README** (*End-to-end tests*).

### Manual SDK Testing

```bash
# Interactive REPL with Claude (streaming)
DAYTONA_API_KEY=dtn_... ANTHROPIC_API_KEY=sk-ant-... npx tsx packages/agents/scripts/repl.ts

# REPL with other providers
npx tsx packages/agents/scripts/repl.ts --provider codex   # requires OPENAI_API_KEY
npx tsx packages/agents/scripts/repl.ts --provider opencode
npx tsx packages/agents/scripts/repl.ts --provider gemini  # requires GEMINI_API_KEY

# Polling-based background session REPL
DAYTONA_API_KEY=dtn_... ANTHROPIC_API_KEY=sk-ant-... npx tsx packages/agents/scripts/repl-polling.ts

# Full integration test script
DAYTONA_API_KEY=dtn_... ANTHROPIC_API_KEY=sk-ant-... npx tsx packages/agents/scripts/test-sdk-full.ts
```

### Debug Mode

Set `CODING_AGENTS_DEBUG=1` to enable verbose logging:

```bash
CODING_AGENTS_DEBUG=1 npx tsx packages/agents/scripts/repl-polling.ts
```

This logs agent lifecycle events, background session details, and unparsed output.
