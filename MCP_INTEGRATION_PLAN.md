# Remote MCP Server Integration Plan

## Overview

Integrate remote MCP (Model Context Protocol) servers into the sandboxed-agents platform, allowing users to connect external tools and services (GitHub, Sentry, Notion, databases, etc.) that AI agents can use during coding sessions.

---

## Key Design Decisions

### 1. Configuration Scope: **Per-Repository Only**
- MCP servers configured entirely at the repository level
- Lives in Repo Settings modal (alongside Environment Variables)
- Each repo has its own MCP servers - no sharing/linking complexity
- If user wants same server on another repo, they set it up again (OAuth is quick)

### 2. Execution Model: **Inside Sandbox**
- MCP tools execute from within the Daytona sandbox
- **All three agents have native MCP support:**
  - **Claude Code**: Config at `~/.claude/mcp_servers.json`
  - **OpenCode**: Config at `~/.config/opencode/opencode.jsonc` (supports OAuth automatically)
  - **Codex**: Config at `~/.codex/config.toml` (supports STDIO + HTTP servers)
- Write agent-specific MCP config file to sandbox before agent starts

### 3. Authentication: **OAuth 2.0 Only** (initially)
- Most commercial MCP servers use OAuth (Notion, Figma, GitHub, etc.)
- OAuth tokens stored encrypted per-repo
- Skip API key support initially - add later if needed

### 4. Transport: **HTTP (Streamable)** Only
- HTTP streamable transport is the standard for remote servers
- SSE is deprecated - no need to support it
- Simplifies implementation

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     User Account                             │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Repo A    │  │   Repo B    │  │   Repo C    │         │
│  │ (frontend)  │  │ (backend)   │  │ (mobile)    │         │
│  │             │  │             │  │             │         │
│  │ MCP Servers:│  │ MCP Servers:│  │ MCP Servers:│         │
│  │ - Figma     │  │ - Sentry    │  │ - Figma     │         │
│  │ - Notion    │  │ - Notion    │  │             │         │
│  │             │  │             │  │             │         │
│  │ Env Vars:   │  │ Env Vars:   │  │ Env Vars:   │         │
│  │ - API_KEY   │  │ - DB_URL    │  │ - API_KEY   │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

Simple: Everything lives at the repo level. No cross-repo sharing.

---

## Database Schema

### New Model: `RepoMcpServer`

Stores MCP server configurations per repository (like `envVars` but structured).

```prisma
model RepoMcpServer {
  id     String @id @default(cuid())
  repoId String
  repo   Repo   @relation(fields: [repoId], references: [id], onDelete: Cascade)

  // Server identification
  slug        String  // "notion", "figma", "sentry", etc.
  name        String  // Display name
  url         String  // MCP server URL (https://mcp.notion.com/mcp)
  iconUrl     String? // Icon URL from registry

  // OAuth tokens (encrypted)
  accessToken  String? @db.Text
  refreshToken String? @db.Text
  tokenExpiry  DateTime?

  // Status
  status    String   @default("connected") // "connected" | "expired" | "error"
  lastError String?  @db.Text

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([repoId, slug]) // One per service per repo
  @@index([repoId])
}
```

### Updated Model

```prisma
model Repo {
  // ... existing fields ...
  mcpServers RepoMcpServer[]
}
```

---

## API Routes

### Repo MCP Servers
| Route | Method | Description |
|-------|--------|-------------|
| `/api/repo/[repoId]/mcp-servers` | GET | List MCP servers for repo |
| `/api/repo/[repoId]/mcp-servers` | POST | Add MCP server to repo |
| `/api/repo/[repoId]/mcp-servers/[serverId]` | DELETE | Remove MCP server from repo |
| `/api/repo/[repoId]/mcp-servers/[serverId]/oauth` | GET | Start OAuth flow for server |
| `/api/auth/mcp-callback` | GET | OAuth callback handler |

### MCP Registry (Discovery)
| Route | Method | Description |
|-------|--------|-------------|
| `/api/mcp-registry` | GET | Proxy to Anthropic registry with search |

---

## UI Components

### 1. Repo Settings Modal - Add "MCP Servers" Tab

Extend existing `repo-settings-modal.tsx` with a second tab:

```
Tabs: [Environment Variables] [MCP Servers]
```

#### MCP Tab Contents:

**Section 1: Connected Servers**
- List of MCP servers connected to this repo
- Each shows: Icon, Name, Status indicator (green/yellow/red), Remove button
- Empty state: "No MCP servers connected. Browse the registry to add one."

**Section 2: Add Server**
- "Browse Registry" button → Opens registry browser modal
- User can discover and connect new services

### 2. Registry Browser Modal

```tsx
// components/mcp/mcp-registry-browser.tsx
interface McpRegistryBrowserProps {
  repoId: string
  onConnect: (server: RegistryServer) => void  // Triggers OAuth flow
  connectedSlugs: string[]  // Already connected to this repo
}
```

**Features**:
- Search bar with debounced search
- Category filter chips (All, Productivity, Design, Development)
- Server cards: Icon, Name, Description, Tools count, "Connect" button
- Infinite scroll pagination
- "Already connected" badge for servers already on this repo

### 3. New Components

| Component | Purpose |
|-----------|---------|
| `components/mcp/mcp-server-list.tsx` | List of connected MCP servers |
| `components/mcp/mcp-registry-browser.tsx` | Browse + search registry |
| `components/mcp/mcp-server-card.tsx` | Individual server card |

---

## User Flow

### Connect MCP Server to Repo

```
1. User opens Repo Settings → MCP Servers tab
2. Clicks "Browse Registry"
3. Searches for "Notion", clicks "Connect"
4. OAuth popup opens → User authorizes with Notion
5. Callback saves token to RepoMcpServer (encrypted)
6. Popup closes, server appears in "Connected Servers"
7. Next agent session will have Notion tools available
```

That's it. Simple and self-contained per repo.

---

## Sandbox Integration

### Modify `lib/sandbox-resume.ts`

```typescript
// 1. Fetch repo's MCP servers
const mcpServers = await prisma.repoMcpServer.findMany({
  where: { repoId, status: "connected" }
})

// 2. Skip if no servers configured
if (mcpServers.length === 0) return

// 3. Decrypt tokens and build agent-specific config
const { configPath, configContent } = buildMcpConfig(mcpServers, agent)

// 4. Write to sandbox
await sandbox.process.executeCommand(
  `mkdir -p $(dirname ${configPath}) && echo '${base64Encode(configContent)}' | base64 -d > ${configPath}`
)
```

**Config paths by agent:**
| Agent | Config Path |
|-------|-------------|
| Claude Code | `~/.claude/mcp_servers.json` |
| OpenCode | `~/.config/opencode/opencode.jsonc` |
| Codex | `~/.codex/config.toml` |

### MCP Config Formats (Per Agent)

**Claude Code** (`~/.claude/mcp_servers.json`):
```json
{
  "mcpServers": {
    "notion": {
      "type": "http",
      "url": "https://mcp.notion.com/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

**OpenCode** (`~/.config/opencode/opencode.jsonc`):
```jsonc
{
  "mcp": {
    "servers": {
      "notion": {
        "type": "remote",
        "url": "https://mcp.notion.com/mcp",
        "headers": {
          "Authorization": "Bearer <token>"
        }
      }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):
```toml
[[mcp.servers]]
name = "notion"
type = "http"
url = "https://mcp.notion.com/mcp"

[mcp.servers.headers]
Authorization = "Bearer <token>"
```

The `buildMcpConfigJson()` function will generate the appropriate format based on the agent being used.

---

## MCP Server Registry

### Registry API

**Endpoint**: `GET https://api.anthropic.com/mcp-registry/v0/servers?visibility=commercial`

**Our Proxy**: `GET /api/mcp-registry?search=notion&limit=20`

### Transformed Response

```typescript
interface RegistryServer {
  slug: string           // "notion"
  name: string           // "Notion"
  description: string    // "Connect your Notion workspace..."
  iconUrl: string        // "https://notion.so/logo.svg"
  url: string            // "https://mcp.notion.com/mcp"
  documentation: string  // Link to docs
  tools: string[]        // ["search", "create-pages", ...]
  requiresAuth: boolean  // true (most do)
  useCases: string[]     // ["productivity"]
}
```

---

## OAuth Flow

```
1. User clicks "Connect" on Notion in registry browser
         ↓
2. Frontend → GET /api/repo/[repoId]/mcp-servers/oauth?slug=notion&url=https://mcp.notion.com/mcp
         ↓
3. Backend:
   - Creates pending RepoMcpServer record
   - Generates state token with {repoId, serverId}
   - Returns authorization URL
         ↓
4. Frontend opens popup to Notion OAuth
         ↓
5. User authorizes in Notion
         ↓
6. Notion → GET /api/auth/mcp-callback?code=xxx&state=xxx
         ↓
7. Backend:
   - Validates state, extracts repoId + serverId
   - Exchanges code for tokens
   - Updates RepoMcpServer with encrypted tokens
   - Sets status = "connected"
   - Returns success (closes popup)
         ↓
8. Frontend refreshes server list, shows new server
```

---

## Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `app/api/repo/[repoId]/mcp-servers/route.ts` | List/add MCP servers for repo |
| `app/api/repo/[repoId]/mcp-servers/[serverId]/route.ts` | Delete server |
| `app/api/repo/[repoId]/mcp-servers/oauth/route.ts` | Start OAuth flow |
| `app/api/auth/mcp-callback/route.ts` | OAuth callback handler |
| `app/api/mcp-registry/route.ts` | Registry proxy |
| `lib/mcp-oauth.ts` | OAuth helpers, token refresh |
| `components/mcp/mcp-server-list.tsx` | Server list for repo settings |
| `components/mcp/mcp-registry-browser.tsx` | Registry browser modal |
| `components/mcp/mcp-server-card.tsx` | Server card component |

### Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add RepoMcpServer model |
| `lib/constants.ts` | Add MCP config paths |
| `lib/api-helpers.ts` | Add MCP token decryption |
| `lib/sandbox-resume.ts` | Write MCP config to sandbox |
| `components/repo-settings-modal.tsx` | Add MCP Servers tab |

---

## Implementation Phases

### Phase 1: Foundation (1-2 days)
- [ ] Add Prisma schema (RepoMcpServer) + migration
- [ ] Create MCP server CRUD API routes
- [ ] Add token encryption/decryption helpers

### Phase 2: OAuth Flow (2 days)
- [ ] Implement OAuth initiation endpoint
- [ ] Create callback handler with token exchange
- [ ] Add token refresh logic

### Phase 3: Repo Settings UI (2 days)
- [ ] Add "MCP Servers" tab to repo settings modal
- [ ] Create server list component (connected servers)
- [ ] Add remove functionality

### Phase 4: Registry Browser (2 days)
- [ ] Create registry proxy API (with caching)
- [ ] Build registry browser modal
- [ ] Add search + category filtering
- [ ] Connect "Add" button to OAuth flow

### Phase 5: Sandbox Integration (1 day)
- [ ] Modify `ensureSandboxReady` to fetch and inject MCP configs
- [ ] Build MCP config JSON generator
- [ ] Test with Claude Code agent + real MCP server (Notion/Figma)

### Phase 6: Polish (1 day)
- [ ] Error handling + status indicators
- [ ] Token expiry handling + auto-refresh
- [ ] End-to-end testing

**Total: ~9-10 days**

---

## Recommendations

### 1. OAuth Only (Initially)
Most commercial MCP servers use OAuth. Skip API key support to reduce complexity. Add later if needed.

### 2. Pre-populate Popular Servers
Show 5-10 popular servers at top of registry browser (before search):
- Notion, Figma, Canva, GitHub, Sentry, Linear, Slack

### 3. Connection Testing
Add "Test Connection" button that calls MCP server's `listTools()` endpoint. Show tool count on success.

### 4. Token Expiry Handling
- Check token expiry before agent execution
- Auto-refresh if expired and refresh token available
- Show "Reconnect" button in UI if refresh fails

### 5. Graceful Error Recovery
When MCP server fails in sandbox:
- Log error to `lastError` field
- Show yellow/red status indicator in UI
- Don't block agent execution - just skip that server

### 6. Future: Custom MCP Servers
Allow adding custom servers by URL (not from registry). Useful for:
- Self-hosted servers
- Internal company tools
- Development/testing

---

## Security Considerations

1. **Encryption**: All tokens use AES encryption via `lib/encryption.ts`
2. **OAuth State**: Encrypted to prevent CSRF
3. **HTTPS Only**: All MCP server URLs must be HTTPS
4. **Sandbox Isolation**: Tokens only exist inside sandbox during execution
5. **Cascading Deletes**: Deleting repo removes all its MCP server configs
