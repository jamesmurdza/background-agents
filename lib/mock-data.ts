export type Agent = "claude-code" | "codex" | "opencode"

export interface ToolCall {
  id: string
  type: "read_file" | "edit_file" | "write_file" | "search" | "terminal" | "pr_ready"
  file?: string
  summary: string
  timestamp: string
}

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  toolCalls?: ToolCall[]
  prLink?: string
  timestamp: string
}

export interface Branch {
  id: string
  name: string
  agent: Agent
  messages: Message[]
  status: "idle" | "running" | "complete"
  lastActivity: string
  unread?: boolean
}

export interface Repo {
  id: string
  name: string
  owner: string
  avatar: string
  branches: Branch[]
}

export const repos: Repo[] = [
  {
    id: "1",
    name: "frontend",
    owner: "acme",
    avatar: "A",
    branches: [
      {
        id: "b1",
        name: "feat/auth-flow",
        agent: "claude-code",
        status: "complete",
        lastActivity: "2m ago",
        unread: true,
        messages: [
          {
            id: "m1",
            role: "user",
            content: "Add OAuth login with Google and GitHub providers. Use NextAuth.js and create a sign-in page with both options.",
            timestamp: "10:32 AM",
          },
          {
            id: "m2",
            role: "assistant",
            content: "I'll set up NextAuth.js with Google and GitHub OAuth providers and create a sign-in page. Let me start by examining the current project structure.",
            toolCalls: [
              { id: "t1", type: "read_file", file: "package.json", summary: "Checking existing dependencies", timestamp: "10:32 AM" },
              { id: "t2", type: "read_file", file: "app/layout.tsx", summary: "Reading root layout", timestamp: "10:32 AM" },
              { id: "t3", type: "terminal", summary: "npm install next-auth @auth/prisma-adapter", timestamp: "10:33 AM" },
              { id: "t4", type: "write_file", file: "app/api/auth/[...nextauth]/route.ts", summary: "Created NextAuth route handler with Google & GitHub providers", timestamp: "10:33 AM" },
              { id: "t5", type: "write_file", file: "app/sign-in/page.tsx", summary: "Created sign-in page with OAuth buttons", timestamp: "10:34 AM" },
              { id: "t6", type: "write_file", file: "components/auth-provider.tsx", summary: "Created session provider wrapper", timestamp: "10:34 AM" },
              { id: "t7", type: "edit_file", file: "app/layout.tsx", summary: "Wrapped app in AuthProvider", timestamp: "10:34 AM" },
            ],
            timestamp: "10:34 AM",
          },
          {
            id: "m3",
            role: "assistant",
            content: "Done! I've set up NextAuth.js with both Google and GitHub OAuth providers. The sign-in page is at `/sign-in` with styled buttons for each provider. I've also wrapped the app in a session provider so you can access auth state anywhere.",
            prLink: "https://github.com/acme/frontend/pull/47",
            timestamp: "10:35 AM",
          },
        ],
      },
      {
        id: "b2",
        name: "fix/nav-responsive",
        agent: "codex",
        status: "running",
        lastActivity: "now",
        unread: true,
        messages: [
          {
            id: "m4",
            role: "user",
            content: "The navigation bar breaks on mobile screens. Fix the responsive layout and add a hamburger menu.",
            timestamp: "11:15 AM",
          },
          {
            id: "m5",
            role: "assistant",
            content: "I'll fix the responsive navigation. Let me look at the current navbar implementation.",
            toolCalls: [
              { id: "t8", type: "read_file", file: "components/navbar.tsx", summary: "Reading current navbar component", timestamp: "11:15 AM" },
              { id: "t9", type: "search", summary: "Searching for mobile breakpoint usage across components", timestamp: "11:15 AM" },
              { id: "t10", type: "edit_file", file: "components/navbar.tsx", summary: "Adding mobile hamburger menu with slide-out drawer", timestamp: "11:16 AM" },
            ],
            timestamp: "11:16 AM",
          },
        ],
      },
      {
        id: "b3",
        name: "feat/dark-mode",
        agent: "claude-code",
        status: "idle",
        lastActivity: "1h ago",
        messages: [
          {
            id: "m6",
            role: "user",
            content: "Add a dark mode toggle to the app. Persist preference in localStorage.",
            timestamp: "9:00 AM",
          },
          {
            id: "m7",
            role: "assistant",
            content: "I'll add dark mode support with a toggle button and localStorage persistence. Let me check how the current theme is set up.",
            toolCalls: [
              { id: "t11", type: "read_file", file: "app/globals.css", summary: "Reading current CSS variables", timestamp: "9:00 AM" },
              { id: "t12", type: "write_file", file: "components/theme-toggle.tsx", summary: "Created theme toggle component", timestamp: "9:01 AM" },
              { id: "t13", type: "edit_file", file: "app/globals.css", summary: "Added dark mode CSS variables", timestamp: "9:01 AM" },
              { id: "t14", type: "edit_file", file: "components/navbar.tsx", summary: "Added theme toggle to navbar", timestamp: "9:02 AM" },
            ],
            timestamp: "9:02 AM",
          },
          {
            id: "m8",
            role: "assistant",
            content: "Dark mode is implemented with a toggle button in the navbar. User preference is persisted in localStorage and respects system preference on first visit.",
            prLink: "https://github.com/acme/frontend/pull/44",
            timestamp: "9:02 AM",
          },
        ],
      },
    ],
  },
  {
    id: "2",
    name: "api-server",
    owner: "acme",
    avatar: "A",
    branches: [
      {
        id: "b4",
        name: "feat/rate-limiting",
        agent: "opencode",
        status: "complete",
        lastActivity: "30m ago",
        messages: [
          {
            id: "m9",
            role: "user",
            content: "Add rate limiting to all API endpoints. Use Redis for tracking and allow 100 requests per minute per API key.",
            timestamp: "10:00 AM",
          },
          {
            id: "m10",
            role: "assistant",
            content: "I'll implement Redis-based rate limiting middleware. Let me check the current middleware setup.",
            toolCalls: [
              { id: "t15", type: "read_file", file: "src/middleware/index.ts", summary: "Reading middleware stack", timestamp: "10:00 AM" },
              { id: "t16", type: "terminal", summary: "npm install ioredis", timestamp: "10:00 AM" },
              { id: "t17", type: "write_file", file: "src/middleware/rate-limit.ts", summary: "Created sliding window rate limiter with Redis", timestamp: "10:01 AM" },
              { id: "t18", type: "edit_file", file: "src/middleware/index.ts", summary: "Added rate limiter to middleware chain", timestamp: "10:02 AM" },
              { id: "t19", type: "write_file", file: "src/middleware/__tests__/rate-limit.test.ts", summary: "Added tests for rate limiting", timestamp: "10:03 AM" },
            ],
            timestamp: "10:03 AM",
          },
          {
            id: "m11",
            role: "assistant",
            content: "Rate limiting is implemented using a sliding window algorithm with Redis. Each API key gets 100 requests per minute. Responses include `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers. Tests are included.",
            prLink: "https://github.com/acme/api-server/pull/112",
            timestamp: "10:03 AM",
          },
        ],
      },
      {
        id: "b5",
        name: "fix/db-connection-pool",
        agent: "claude-code",
        status: "idle",
        lastActivity: "2h ago",
        messages: [
          {
            id: "m12",
            role: "user",
            content: "We're hitting connection pool exhaustion under load. Optimize the database connection pooling configuration.",
            timestamp: "8:15 AM",
          },
          {
            id: "m13",
            role: "assistant",
            content: "I'll investigate and optimize the database connection pooling. Let me analyze the current configuration and connection usage patterns.",
            toolCalls: [
              { id: "t20", type: "read_file", file: "src/db/config.ts", summary: "Reading DB configuration", timestamp: "8:15 AM" },
              { id: "t21", type: "search", summary: "Searching for all database connection usages", timestamp: "8:16 AM" },
              { id: "t22", type: "edit_file", file: "src/db/config.ts", summary: "Optimized pool size, idle timeout, and connection reaping", timestamp: "8:17 AM" },
            ],
            timestamp: "8:17 AM",
          },
          {
            id: "m14",
            role: "assistant",
            content: "I've optimized the connection pool: increased max pool size to 20, set idle timeout to 10s, enabled connection reaping every 30s, and added proper error handling for connection acquisition timeouts.",
            prLink: "https://github.com/acme/api-server/pull/110",
            timestamp: "8:18 AM",
          },
        ],
      },
    ],
  },
  {
    id: "3",
    name: "ml-pipeline",
    owner: "acme",
    avatar: "A",
    branches: [
      {
        id: "b6",
        name: "feat/batch-inference",
        agent: "claude-code",
        status: "running",
        lastActivity: "now",
        unread: true,
        messages: [
          {
            id: "m15",
            role: "user",
            content: "Add batch inference support to the prediction service. Should handle up to 1000 items per batch with progress tracking.",
            timestamp: "11:00 AM",
          },
          {
            id: "m16",
            role: "assistant",
            content: "I'll add batch inference with progress tracking to the prediction service. Let me review the current single-inference implementation.",
            toolCalls: [
              { id: "t23", type: "read_file", file: "src/services/prediction.py", summary: "Reading prediction service", timestamp: "11:00 AM" },
              { id: "t24", type: "read_file", file: "src/api/routes.py", summary: "Reading API routes", timestamp: "11:00 AM" },
              { id: "t25", type: "write_file", file: "src/services/batch.py", summary: "Created batch inference service with chunked processing", timestamp: "11:02 AM" },
            ],
            timestamp: "11:02 AM",
          },
        ],
      },
    ],
  },
  {
    id: "4",
    name: "docs",
    owner: "acme",
    avatar: "A",
    branches: [
      {
        id: "b7",
        name: "update/api-reference",
        agent: "codex",
        status: "idle",
        lastActivity: "3h ago",
        messages: [],
      },
    ],
  },
]

export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "codex": "Codex",
  "opencode": "OpenCode",
}
