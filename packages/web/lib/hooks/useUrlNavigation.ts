/**
 * Route match results - each route returns its extracted params or null if no match
 */
export type RouteMatch<T> = T | null

/**
 * Unified route definitions with both build and match functions
 * This ensures URL building and parsing are always in sync
 */
export const ROUTES = {
  home: {
    path: "/",
    build: () => "/" as const,
    match: (path: string): RouteMatch<Record<string, never>> =>
      path === "/" ? {} : null,
  },
  chat: {
    path: "/chat/:chatId",
    build: (chatId: string) => `/chat/${chatId}` as const,
    match: (path: string): RouteMatch<{ chatId: string }> => {
      const m = path.match(/^\/chat\/([^/]+)$/)
      return m ? { chatId: m[1] } : null
    },
  },
  newChat: {
    path: "/chat/new",
    build: () => "/chat/new" as const,
    match: (path: string): RouteMatch<Record<string, never>> =>
      path === "/chat/new" ? {} : null,
  },
  jobs: {
    path: "/jobs",
    build: () => "/jobs" as const,
    match: (path: string): RouteMatch<Record<string, never>> =>
      path === "/jobs" ? {} : null,
  },
  job: {
    path: "/jobs/:jobId",
    build: (jobId: string) => `/jobs/${jobId}` as const,
    match: (path: string): RouteMatch<{ jobId: string }> => {
      const m = path.match(/^\/jobs\/([^/]+)$/)
      return m ? { jobId: m[1] } : null
    },
  },
  jobRun: {
    path: "/jobs/:jobId/runs/:runId",
    build: (jobId: string, runId: string) => `/jobs/${jobId}/runs/${runId}` as const,
    match: (path: string): RouteMatch<{ jobId: string; runId: string }> => {
      const m = path.match(/^\/jobs\/([^/]+)\/runs\/([^/]+)$/)
      return m ? { jobId: m[1], runId: m[2] } : null
    },
  },
} as const

/**
 * Helper to match a path against all routes and return the first match
 * Routes are checked in order of specificity (more specific first)
 */
export function matchRoute(path: string):
  | { route: "newChat" }
  | { route: "chat"; chatId: string }
  | { route: "jobRun"; jobId: string; runId: string }
  | { route: "job"; jobId: string }
  | { route: "jobs" }
  | { route: "home" }
  | null {
  // Check in order of specificity (more specific patterns first)

  // newChat must be before chat (since /chat/new would match /chat/:chatId)
  if (ROUTES.newChat.match(path)) {
    return { route: "newChat" }
  }

  const chatMatch = ROUTES.chat.match(path)
  if (chatMatch) {
    return { route: "chat", chatId: chatMatch.chatId }
  }

  // jobRun must be before job (since /jobs/:id/runs/:runId would match /jobs/:id first)
  const jobRunMatch = ROUTES.jobRun.match(path)
  if (jobRunMatch) {
    return { route: "jobRun", jobId: jobRunMatch.jobId, runId: jobRunMatch.runId }
  }

  const jobMatch = ROUTES.job.match(path)
  if (jobMatch) {
    return { route: "job", jobId: jobMatch.jobId }
  }

  if (ROUTES.jobs.match(path)) {
    return { route: "jobs" }
  }

  if (ROUTES.home.match(path)) {
    return { route: "home" }
  }

  return null
}
