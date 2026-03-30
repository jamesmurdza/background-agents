/**
 * Query key factory for TanStack Query
 *
 * Provides a centralized, type-safe way to manage query keys.
 */
export const queryKeys = {
  user: {
    all: ["user"] as const,
    me: () => [...queryKeys.user.all, "me"] as const,
  },
  sync: {
    all: ["sync"] as const,
    data: () => [...queryKeys.sync.all, "data"] as const,
  },
} as const

export type QueryKeys = typeof queryKeys
