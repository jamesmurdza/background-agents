# Sandboxed Agents

A multi-tenant web application that lets users run Claude Code agents in isolated Daytona sandboxes. Each user gets their own sandboxes linked to GitHub repositories, with real-time streaming of agent output.

## Features

- **GitHub OAuth Login** - Sign in with GitHub, OAuth tokens used for repo access
- **Isolated Sandboxes** - Each branch gets its own Daytona sandbox with Claude Code
- **Real-time Streaming** - Live agent output via Server-Sent Events
- **Multi-tenant** - User data isolated, shared Daytona infrastructure
- **Quota Enforcement** - 5 concurrent sandboxes per user
- **Encrypted Credentials** - User's Anthropic API keys stored encrypted in database

## Architecture

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────┐
│   Browser       │────▶│   Next.js API     │────▶│   Neon DB    │
│   (React)       │     │   (Vercel)        │     │  (Postgres)  │
└─────────────────┘     └─────────┬─────────┘     └──────────────┘
                                  │
                                  ▼
                        ┌───────────────────┐     ┌──────────────┐
                        │  Daytona Sandbox  │────▶│  Claude API  │
                        │  (Python Agent)   │     │  (Anthropic) │
                        └───────────────────┘     └──────────────┘
```

### Data Flow

1. User authenticates via GitHub OAuth (NextAuth.js)
2. User adds repositories and creates branches
3. Each branch spins up a Daytona sandbox with Claude Code agent
4. User sends prompts → API streams agent output back in real-time
5. Agent can read/write files, run commands, make commits

### Credential Management

| Credential | Storage | Access |
|------------|---------|--------|
| GitHub OAuth Token | NextAuth Account table | Server-side only |
| Daytona API Key | Environment variable | Shared, server-side only |
| Anthropic API Key | Encrypted in database | User provides, decrypted at runtime |

---

## Setup

### Prerequisites

- Node.js 18+
- A Vercel account (for deployment + Neon integration)
- A GitHub account (for OAuth app)
- A Daytona API key

### 1. Neon Database

**Option A: Via Vercel (Recommended)**
1. Go to your Vercel project → **Storage** tab
2. Click **Create Database** → Select **Neon Postgres**
3. Vercel auto-adds `DATABASE_URL` and `DATABASE_URL_UNPOOLED` env vars

**Option B: Direct Setup**
1. Go to [neon.tech](https://neon.tech) → Create project
2. Copy the connection strings
3. Add to Vercel env vars:
   ```
   DATABASE_URL=postgres://...?sslmode=require
   DATABASE_URL_UNPOOLED=postgres://...?sslmode=require
   ```

### 2. GitHub OAuth App

1. Go to GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: `Sandboxed Agents`
   - **Homepage URL**: `https://your-app.vercel.app`
   - **Authorization callback URL**: `https://your-app.vercel.app/api/auth/callback/github`
3. Click **Register application**
4. Copy the **Client ID**
5. Generate a **Client Secret** and copy it

### 3. Generate Secrets

```bash
# NextAuth secret
openssl rand -base64 32

# Encryption key for storing Anthropic credentials
openssl rand -hex 32
```

### 4. Environment Variables

Add these to Vercel (Settings → Environment Variables):

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Neon pooled connection | (auto-set by Vercel) |
| `DATABASE_URL_UNPOOLED` | Neon direct connection (migrations) | (auto-set by Vercel) |
| `NEXTAUTH_URL` | Your app's URL | `https://your-app.vercel.app` |
| `NEXTAUTH_SECRET` | Random secret for NextAuth | (output of `openssl rand -base64 32`) |
| `GITHUB_CLIENT_ID` | From GitHub OAuth App | `Ov23li...` |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App | `abc123...` |
| `ENCRYPTION_KEY` | For encrypting Anthropic keys | (output of `openssl rand -hex 32`) |
| `DAYTONA_API_KEY` | Your shared Daytona API key | `dtn_...` |
| `DAYTONA_API_URL` | Daytona API endpoint | `https://api.daytona.io` |

### 5. Deploy

```bash
# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run migrations (uses DATABASE_URL_UNPOOLED)
npx prisma migrate deploy

# Build
npm run build
```

Or just push to Vercel - the build script handles migrations automatically.

### 6. Setup Checklist

```
[ ] Neon database provisioned
[ ] DATABASE_URL set
[ ] DATABASE_URL_UNPOOLED set
[ ] GitHub OAuth App created
[ ] GITHUB_CLIENT_ID set
[ ] GITHUB_CLIENT_SECRET set
[ ] NEXTAUTH_URL set
[ ] NEXTAUTH_SECRET set
[ ] ENCRYPTION_KEY set
[ ] DAYTONA_API_KEY set
```

---

## Development

```bash
# Install dependencies
npm install

# Set up local env (copy from Vercel or create .env.local)
cp .env.example .env.local

# Run migrations
npx prisma migrate dev

# Start dev server
npm run dev
```

### Local Environment

Create `.env.local`:

```env
DATABASE_URL="postgres://..."
DATABASE_URL_UNPOOLED="postgres://..."
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="dev-secret-change-in-prod"
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
ENCRYPTION_KEY="..."
DAYTONA_API_KEY="dtn_..."
DAYTONA_API_URL="https://api.daytona.io"
```

> **Note**: For local GitHub OAuth, create a separate OAuth App with callback URL `http://localhost:3000/api/auth/callback/github`

### Local coding-agents-sdk

To develop against the local `@jamesmurdza/coding-agents-sdk` repo instead of the npm package:

1. **Switch to local SDK** (run after clone or when you want to use local again):
   ```bash
   npm run install:local
   ```
   This installs deps, symlinks `node_modules/@jamesmurdza/coding-agents-sdk` to `/Users/jamie/codeagentsdk`, and builds the SDK.

2. **Run dev with local SDK and debug logs**:
   ```bash
   npm run dev:local
   ```
   Runs `install:local` then `npm run dev` with `CODING_AGENTS_DEBUG=1`.

3. **After changing the SDK**, rebuild so the app picks it up:
   ```bash
   npm run build-sdk
   ```

4. **Switch back to the published SDK**:
   ```bash
   npm install
   ```

The local SDK path is set in `scripts/link-local-sdk.js`; change it if your repo lives elsewhere.

---

## Database Schema

```
User
├── id, name, email, image (NextAuth)
├── githubId, githubLogin
├── credentials (1:1) → UserCredentials
├── repos (1:n) → Repo
└── sandboxes (1:n) → Sandbox

UserCredentials
├── anthropicApiKey (encrypted)
├── anthropicAuthType ("api-key" | "claude-max")
└── anthropicAuthToken (encrypted, for Claude Max)

Repo
├── owner, name, defaultBranch
└── branches (1:n) → Branch

Branch
├── name, startCommit, status
├── sandbox (1:1) → Sandbox
└── messages (1:n) → Message

Sandbox
├── sandboxId (format: agenthub-{userId}-{uuid})
├── sandboxName, status, contextId
└── lastActiveAt

Message
├── role ("user" | "assistant")
├── content, toolCalls (JSON)
└── createdAt
```

---

## Quotas

- **Concurrent sandboxes**: 5 per user
- When limit reached: New sandbox creation blocked until user stops an existing one
- Sandbox naming: `agenthub-{userId-prefix}-{uuid}`

---

## API Routes

### Auth
- `GET/POST /api/auth/[...nextauth]` - NextAuth handlers

### User
- `GET /api/user/me` - Get current user with repos and quota
- `POST /api/user/credentials` - Save Anthropic credentials (encrypted)
- `DELETE /api/user/credentials` - Clear credentials
- `GET /api/user/quota` - Get quota usage

### Repos & Branches
- `GET /api/repos` - List user's repos
- `POST /api/repos` - Add repo
- `DELETE /api/repos/[id]` - Remove repo
- `GET /api/repos/[id]/branches` - List branches
- `POST /api/repos/[id]/branches` - Create branch
- `GET /api/branches/[id]/messages` - Get chat history
- `POST /api/branches/[id]/messages` - Save message

### Sandbox
- `POST /api/sandbox/create` - Create sandbox (checks quota)
- `POST /api/sandbox/delete` - Delete sandbox
- `POST /api/sandbox/status` - Get/update sandbox status
- `POST /api/agent/query` - Stream agent query (SSE)

### GitHub (uses OAuth token)
- `GET /api/github/repos` - List user's repos
- `GET /api/github/branches` - List branches
- `POST /api/github/pr` - Create pull request

---

## Streaming

Agent output streams via Server-Sent Events:

```typescript
// Frontend
const response = await fetch("/api/agent/query", {
  method: "POST",
  credentials: "include",  // Session cookie
  body: JSON.stringify({ sandboxId, prompt }),
})

const reader = response.body.getReader()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  // Parse SSE: "data: {...}\n\n"
}
```

Event types:
- `{ type: "stdout", content: "..." }` - Agent output
- `{ type: "stderr", content: "..." }` - Agent errors
- `{ type: "context-updated", contextId: "..." }` - Session resumed
- `{ type: "session-id", sessionId: "..." }` - For resumption
- `{ type: "error", message: "..." }` - Fatal error
- `{ type: "done" }` - Query complete

---

## Security

- **No credentials in localStorage** - All secrets server-side
- **Encrypted at rest** - Anthropic keys AES encrypted in database
- **Session-based auth** - JWT via NextAuth, HTTP-only cookies
- **Sandbox isolation** - Users can only access their own sandboxes
- **Shared Daytona key** - Never exposed to frontend

---

## License

MIT
