# Multi-Tenant Auth & Database Implementation Plan

## Overview

Transform the current client-side-only application into a multi-tenant system with:
- GitHub OAuth authentication (replacing PAT)
- Neon PostgreSQL database (via Vercel integration)
- Server-side credential management
- Shared Daytona API key
- Per-user quota enforcement (5 concurrent sandboxes)
- Encrypted storage of user's Anthropic credentials

---

## Architecture Changes

### Current State
```
Browser (localStorage) ←→ Next.js API Routes ←→ Daytona/GitHub APIs
     ↑
     └── All credentials stored here (insecure)
```

### Target State
```
Browser (no secrets) ←→ Next.js API Routes ←→ Neon DB (user data + encrypted creds)
                              ↓
                    Daytona API (shared key from env)
                              ↓
                    GitHub API (OAuth token from NextAuth)
```

---

## Phase 1: Database Setup (Neon + Prisma)

### 1.1 Install Dependencies
```bash
npm install @prisma/client prisma @neondatabase/serverless
npm install next-auth @auth/prisma-adapter
npm install crypto-js @types/crypto-js  # For encryption
```

### 1.2 Prisma Schema (`prisma/schema.prisma`)
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_DATABASE_URL")  # For migrations
}

// NextAuth required tables
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  githubId      String?   @unique
  githubLogin   String?

  accounts      Account[]
  sessions      Session[]
  credentials   UserCredentials?
  repos         Repo[]
  sandboxes     Sandbox[]

  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// Application-specific tables
model UserCredentials {
  id                    String  @id @default(cuid())
  userId                String  @unique
  user                  User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Encrypted Anthropic credentials
  anthropicApiKey       String? @db.Text  // Encrypted
  anthropicAuthType     String  @default("api-key")  // "api-key" | "claude-max"
  anthropicAuthToken    String? @db.Text  // Encrypted (for Claude Max)

  updatedAt             DateTime @updatedAt
}

model Repo {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  name          String
  owner         String
  avatar        String?
  defaultBranch String

  branches      Branch[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, owner, name])
}

model Branch {
  id            String   @id @default(cuid())
  repoId        String
  repo          Repo     @relation(fields: [repoId], references: [id], onDelete: Cascade)

  name          String
  startCommit   String?
  status        String   @default("idle")  // "idle" | "running" | "error"

  sandbox       Sandbox?
  messages      Message[]

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([repoId, name])
}

model Sandbox {
  id            String   @id @default(cuid())

  // Daytona sandbox info
  sandboxId     String   @unique  // Format: agenthub-{userId}-{uuid}
  sandboxName   String

  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  branchId      String   @unique
  branch        Branch   @relation(fields: [branchId], references: [id], onDelete: Cascade)

  contextId     String?  // For agent session resumption
  status        String   @default("creating")  // "creating" | "running" | "stopped" | "error"

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  lastActiveAt  DateTime @default(now())
}

model Message {
  id            String   @id @default(cuid())
  branchId      String
  branch        Branch   @relation(fields: [branchId], references: [id], onDelete: Cascade)

  role          String   // "user" | "assistant"
  content       String   @db.Text
  toolCalls     Json?    // Store tool calls as JSON

  createdAt     DateTime @default(now())

  @@index([branchId, createdAt])
}
```

### 1.3 Environment Variables (Vercel)
```env
# Neon Database (from Vercel integration)
DATABASE_URL="postgres://..."
DIRECT_DATABASE_URL="postgres://..."  # For migrations (non-pooled)

# NextAuth
NEXTAUTH_URL="https://your-app.vercel.app"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# GitHub OAuth App
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."

# Daytona (shared for all users)
DAYTONA_API_KEY="dtn_..."
DAYTONA_API_URL="https://api.daytona.io"

# Encryption
ENCRYPTION_KEY="generate-32-byte-hex-key"
```

---

## Phase 2: NextAuth.js Setup

### 2.1 Auth Configuration (`lib/auth.ts`)
```typescript
import { PrismaAdapter } from "@auth/prisma-adapter"
import { NextAuthOptions } from "next-auth"
import GitHubProvider from "next-auth/providers/github"
import { prisma } from "@/lib/prisma"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "repo read:user",
        },
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
        // Fetch GitHub token from Account table
        const account = await prisma.account.findFirst({
          where: { userId: user.id, provider: "github" },
        })
        session.accessToken = account?.access_token
      }
      return session
    },
    async signIn({ user, account, profile }) {
      // Store GitHub-specific info
      if (account?.provider === "github" && profile) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            githubId: String((profile as any).id),
            githubLogin: (profile as any).login,
          },
        })
      }
      return true
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",  // NextAuth default
  },
}
```

### 2.2 Auth API Route (`app/api/auth/[...nextauth]/route.ts`)
```typescript
import NextAuth from "next-auth"
import { authOptions } from "@/lib/auth"

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

### 2.3 Session Types (`types/next-auth.d.ts`)
```typescript
import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
    } & DefaultSession["user"]
    accessToken?: string
  }
}
```

---

## Phase 3: Encryption Utilities

### 3.1 Encryption Helper (`lib/encryption.ts`)
```typescript
import CryptoJS from "crypto-js"

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString()
}

export function decrypt(ciphertext: string): string {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY)
  return bytes.toString(CryptoJS.enc.Utf8)
}
```

---

## Phase 4: API Route Refactoring

### 4.1 Auth Middleware Pattern (`lib/api-auth.ts`)
```typescript
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function getAuthenticatedUser() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { credentials: true },
  })

  return { session, user }
}

export function unauthorized() {
  return Response.json({ error: "Unauthorized" }, { status: 401 })
}
```

### 4.2 Quota Enforcement (`lib/quota.ts`)
```typescript
import { prisma } from "@/lib/prisma"

const MAX_CONCURRENT_SANDBOXES = 5

export async function checkQuota(userId: string): Promise<{
  allowed: boolean
  current: number
  max: number
}> {
  const activeSandboxes = await prisma.sandbox.count({
    where: {
      userId,
      status: { in: ["creating", "running"] },
    },
  })

  return {
    allowed: activeSandboxes < MAX_CONCURRENT_SANDBOXES,
    current: activeSandboxes,
    max: MAX_CONCURRENT_SANDBOXES,
  }
}
```

### 4.3 Sandbox Name Generation (`lib/sandbox-utils.ts`)
```typescript
import { randomUUID } from "crypto"

export function generateSandboxName(userId: string): string {
  const uuid = randomUUID().split("-")[0]  // First segment for brevity
  return `agenthub-${userId.slice(0, 8)}-${uuid}`
}
```

### 4.4 Refactored API Routes

**Before** (`/api/sandbox/create` - current):
```typescript
// Receives daytonaApiKey, githubPat, anthropicApiKey in request body
```

**After** (`/api/sandbox/create` - new):
```typescript
import { getAuthenticatedUser, unauthorized } from "@/lib/api-auth"
import { checkQuota } from "@/lib/quota"
import { generateSandboxName } from "@/lib/sandbox-utils"
import { decrypt } from "@/lib/encryption"
import { Daytona } from "@daytonaio/sdk"

export async function POST(req: Request) {
  // 1. Authenticate
  const auth = await getAuthenticatedUser()
  if (!auth) return unauthorized()
  const { session, user } = auth

  // 2. Check quota
  const quota = await checkQuota(user.id)
  if (!quota.allowed) {
    return Response.json({
      error: "Quota exceeded",
      message: `You have ${quota.current}/${quota.max} sandboxes running. Please stop one before creating another.`,
    }, { status: 429 })
  }

  // 3. Get credentials
  const githubToken = session.accessToken  // From NextAuth
  const daytonaApiKey = process.env.DAYTONA_API_KEY!  // Shared

  // Decrypt user's Anthropic credentials
  let anthropicApiKey = null
  let anthropicAuthToken = null
  if (user.credentials) {
    if (user.credentials.anthropicApiKey) {
      anthropicApiKey = decrypt(user.credentials.anthropicApiKey)
    }
    if (user.credentials.anthropicAuthToken) {
      anthropicAuthToken = decrypt(user.credentials.anthropicAuthToken)
    }
  }

  // 4. Create sandbox with unique name
  const sandboxName = generateSandboxName(user.id)

  const daytona = new Daytona({ apiKey: daytonaApiKey })
  // ... rest of sandbox creation logic

  // 5. Save to database
  await prisma.sandbox.create({
    data: {
      sandboxId: sandbox.id,
      sandboxName,
      userId: user.id,
      branchId: branch.id,
      status: "running",
    },
  })

  return Response.json({ success: true, sandboxId: sandbox.id })
}
```

---

## Phase 5: Frontend Changes

### 5.1 Remove localStorage Dependencies

**Files to modify:**
- `lib/store.ts` → Remove credentials from localStorage, keep only UI preferences
- `components/settings-modal.tsx` → Only show Anthropic settings, save to DB via API
- `app/page.tsx` → Fetch user data from API instead of localStorage
- `components/add-repo-modal.tsx` → Use session token instead of passed PAT
- `components/branch-list.tsx` → Remove credential passing

### 5.2 New Store Pattern (`lib/store.ts`)
```typescript
// Only store non-sensitive UI preferences in localStorage
const UI_PREFS_KEY = "agenthub:ui-prefs"

interface UIPreferences {
  sidebarCollapsed: boolean
  theme: "light" | "dark" | "system"
}

// All user data (repos, branches, messages) fetched from API
// No credentials in localStorage
```

### 5.3 New Hooks

**`hooks/use-user.ts`** - Fetch authenticated user data:
```typescript
import { useSession } from "next-auth/react"
import useSWR from "swr"

export function useUser() {
  const { data: session, status } = useSession()

  const { data: userData, mutate } = useSWR(
    status === "authenticated" ? "/api/user/me" : null,
    fetcher
  )

  return {
    user: userData?.user,
    repos: userData?.repos,
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
    mutate,
  }
}
```

**`hooks/use-credentials.ts`** - Manage Anthropic credentials:
```typescript
export function useCredentials() {
  const { mutate } = useUser()

  async function saveCredentials(credentials: {
    anthropicApiKey?: string
    anthropicAuthType: "api-key" | "claude-max"
    anthropicAuthToken?: string
  }) {
    await fetch("/api/user/credentials", {
      method: "POST",
      body: JSON.stringify(credentials),
    })
    mutate()
  }

  return { saveCredentials }
}
```

### 5.4 Login Page (`app/login/page.tsx`)
```typescript
"use client"
import { signIn } from "next-auth/react"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-4">Welcome to AgentHub</h1>
        <p className="text-muted-foreground mb-6">
          Sign in with GitHub to get started
        </p>
        <button
          onClick={() => signIn("github", { callbackUrl: "/" })}
          className="bg-primary text-primary-foreground px-6 py-3 rounded-lg"
        >
          Sign in with GitHub
        </button>
      </div>
    </div>
  )
}
```

### 5.5 Settings Modal Changes
- Remove GitHub PAT field (handled by OAuth)
- Remove Daytona API key field (shared, server-side only)
- Keep Anthropic settings (API key or Claude Max credentials)
- Save to database instead of localStorage

---

## Phase 6: New API Endpoints

### 6.1 User Data Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/user/me` | GET | Get current user with repos, branches, quota |
| `/api/user/credentials` | POST | Save encrypted Anthropic credentials |
| `/api/user/credentials` | DELETE | Clear Anthropic credentials |
| `/api/user/quota` | GET | Get current quota usage |

### 6.2 Repo/Branch Endpoints (now DB-backed)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/repos` | GET | List user's repos from DB |
| `/api/repos` | POST | Add repo to user's list |
| `/api/repos/[id]` | DELETE | Remove repo |
| `/api/repos/[id]/branches` | GET | List branches with sandbox status |
| `/api/repos/[id]/branches` | POST | Create branch record |
| `/api/branches/[id]/messages` | GET | Get chat history |
| `/api/branches/[id]/messages` | POST | Save message |

---

## Phase 7: File Changes Summary

### New Files
```
prisma/
  schema.prisma              # Database schema

lib/
  prisma.ts                  # Prisma client singleton
  auth.ts                    # NextAuth configuration
  encryption.ts              # Encrypt/decrypt helpers
  api-auth.ts                # Auth middleware
  quota.ts                   # Quota enforcement

app/
  login/
    page.tsx                 # Login page
  api/
    auth/[...nextauth]/
      route.ts               # NextAuth handler
    user/
      me/route.ts            # Get user data
      credentials/route.ts   # Save/delete credentials
      quota/route.ts         # Quota info
    repos/
      route.ts               # List/add repos
      [id]/route.ts          # Delete repo
      [id]/branches/route.ts # Branch operations
    branches/
      [id]/messages/route.ts # Message history

hooks/
  use-user.ts                # User data hook
  use-credentials.ts         # Credentials hook

types/
  next-auth.d.ts             # NextAuth type extensions
```

### Modified Files
```
lib/
  store.ts                   # Remove credentials, keep UI prefs only
  types.ts                   # Update types for DB models

components/
  settings-modal.tsx         # Remove GitHub/Daytona fields
  add-repo-modal.tsx         # Use session token
  branch-list.tsx            # Remove credential passing
  chat-panel.tsx             # Fetch messages from DB

app/
  page.tsx                   # Use useUser hook, auth checks
  layout.tsx                 # Add SessionProvider
  api/
    sandbox/create/route.ts  # Use shared Daytona key, quota check
    sandbox/delete/route.ts  # Auth check, update DB
    sandbox/status/route.ts  # Auth check
    github/*.ts              # Use session OAuth token
    agent/query/route.ts     # Decrypt credentials from DB
```

### Deleted Files
```
(none - all files modified or replaced)
```

---

## Phase 8: Migration Steps

### 8.1 Development Setup
1. Set up Neon database via Vercel integration
2. Create GitHub OAuth App (Settings → Developer → OAuth Apps)
3. Configure environment variables
4. Run `npx prisma migrate dev`

### 8.2 Implementation Order
1. **Database + Prisma** - Schema, client, migrations
2. **NextAuth** - Auth routes, session handling
3. **Encryption utilities** - For credential storage
4. **API auth middleware** - Protect all routes
5. **New API endpoints** - User, repos, branches, messages
6. **Refactor existing APIs** - Remove credential params
7. **Frontend hooks** - useUser, useCredentials
8. **Frontend components** - Settings, login, remove localStorage
9. **Quota enforcement** - Add checks to sandbox creation
10. **Testing** - End-to-end flow testing

### 8.3 Deployment Checklist
- [ ] Neon database provisioned
- [ ] GitHub OAuth App created
- [ ] All env vars set in Vercel
- [ ] Prisma migrations run
- [ ] Old localStorage keys ignored (clean slate)

---

## Security Improvements

| Before | After |
|--------|-------|
| All credentials in localStorage | Credentials encrypted in DB |
| Credentials sent in request bodies | Server-side credential access |
| No authentication | GitHub OAuth required |
| No rate limiting | Quota enforcement |
| Shared nothing | Shared Daytona key (hidden) |
| Token in query params | OAuth token in session |
| Anyone can use any sandbox | User can only access own sandboxes |

---

## Quota Display UI

Add to settings or header:
```
Sandboxes: 2/5 active
[████████░░]
```

Show warning when at 4/5:
```
⚠️ You're using 4 of 5 available sandboxes
```

Block at 5/5:
```
❌ Sandbox limit reached (5/5)
Please stop a sandbox before creating a new one.
```

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Database Setup | 2-3 hours |
| Phase 2: NextAuth Setup | 2-3 hours |
| Phase 3: Encryption | 1 hour |
| Phase 4: API Refactoring | 4-6 hours |
| Phase 5: Frontend Changes | 4-6 hours |
| Phase 6: New Endpoints | 3-4 hours |
| Phase 7: Testing & Polish | 2-3 hours |
| **Total** | **18-26 hours** |

---

## Open Questions Resolved

| Question | Decision |
|----------|----------|
| Quota type | Concurrent sandboxes only (5 max) |
| Daytona key | Environment variable |
| Quota exceeded | Block new sandboxes |
| Admin features | None |
| Session strategy | NextAuth JWT default |
| Anthropic storage | Encrypted in database |
| GitHub scopes | repo + read:user |
| Data migration | Clean slate |
| Encryption key | Single env var |
| Sandbox naming | `agenthub-{userId}-{uuid}` |
| GitHub token | NextAuth default handling |
