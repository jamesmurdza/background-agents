/**
 * Query key factory for TanStack Query
 *
 * This provides a centralized, type-safe way to manage query keys.
 * Using a factory pattern ensures consistency and makes cache invalidation easier.
 */
export const queryKeys = {
  // User queries
  user: {
    all: ["user"] as const,
    me: () => [...queryKeys.user.all, "me"] as const,
    quota: () => [...queryKeys.user.all, "quota"] as const,
    credentials: () => [...queryKeys.user.all, "credentials"] as const,
  },

  // Repo queries
  repos: {
    all: ["repos"] as const,
    list: () => [...queryKeys.repos.all, "list"] as const,
    detail: (repoId: string) => [...queryKeys.repos.all, repoId] as const,
  },

  // Branch queries
  branches: {
    all: ["branches"] as const,
    byRepo: (repoId: string) => [...queryKeys.branches.all, repoId] as const,
    detail: (branchId: string) => [...queryKeys.branches.all, "detail", branchId] as const,
    messages: (branchId: string) => [...queryKeys.branches.all, branchId, "messages"] as const,
  },

  // Sync queries
  sync: {
    all: ["sync"] as const,
    data: () => [...queryKeys.sync.all, "data"] as const,
  },

  // Execution queries
  execution: {
    all: ["execution"] as const,
    status: (executionId: string) => [...queryKeys.execution.all, executionId] as const,
    active: (branchId: string) => [...queryKeys.execution.all, "active", branchId] as const,
  },
} as const

// Type helpers for query keys
export type QueryKeys = typeof queryKeys
export type UserQueryKey = ReturnType<typeof queryKeys.user.me>
export type SyncQueryKey = ReturnType<typeof queryKeys.sync.data>
export type ExecutionStatusQueryKey = ReturnType<typeof queryKeys.execution.status>
export type BranchMessagesQueryKey = ReturnType<typeof queryKeys.branches.messages>
