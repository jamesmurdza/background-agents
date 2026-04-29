/**
 * Query key factory for TanStack Query
 *
 * Provides type-safe, hierarchical query keys for cache management.
 * Keys are structured for easy invalidation at different granularities.
 */

export const queryKeys = {
  // Chats
  chats: {
    all: ["chats"] as const,
    list: () => [...queryKeys.chats.all, "list"] as const,
    detail: (chatId: string) => [...queryKeys.chats.all, "detail", chatId] as const,
    messages: (chatId: string) => [...queryKeys.chats.detail(chatId), "messages"] as const,
  },

  // Settings
  settings: {
    all: ["settings"] as const,
  },

  // GitHub
  github: {
    all: ["github"] as const,
    repos: () => [...queryKeys.github.all, "repos"] as const,
    branches: (owner: string, repo: string) =>
      [...queryKeys.github.all, "branches", owner, repo] as const,
    compare: (owner: string, repo: string, base: string, head: string) =>
      [...queryKeys.github.all, "compare", owner, repo, base, head] as const,
  },

  // Sandbox
  sandbox: {
    all: ["sandbox"] as const,
    servers: (sandboxId: string) => [...queryKeys.sandbox.all, "servers", sandboxId] as const,
    files: (sandboxId: string, filePath: string) =>
      [...queryKeys.sandbox.all, "files", sandboxId, filePath] as const,
  },

  // Admin
  admin: {
    all: ["admin"] as const,
    stats: () => [...queryKeys.admin.all, "stats"] as const,
    activity: (page: number, filters?: { action?: string; userId?: string }) =>
      [...queryKeys.admin.all, "activity", { page, ...filters }] as const,
    users: (page: number, search?: string) =>
      [...queryKeys.admin.all, "users", { page, search }] as const,
  },
}

// Type helpers for query keys
export type QueryKeys = typeof queryKeys
export type ChatsQueryKey = ReturnType<typeof queryKeys.chats.list>
export type ChatDetailQueryKey = ReturnType<typeof queryKeys.chats.detail>
export type SettingsQueryKey = typeof queryKeys.settings.all
export type ReposQueryKey = ReturnType<typeof queryKeys.github.repos>
export type BranchesQueryKey = ReturnType<typeof queryKeys.github.branches>
export type ServersQueryKey = ReturnType<typeof queryKeys.sandbox.servers>
