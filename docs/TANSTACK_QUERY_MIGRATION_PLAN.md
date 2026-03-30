# TanStack Query Migration Plan

## Overview

This document outlines the migration plan for adopting TanStack Query (React Query) in the sandboxed-agents web application. The migration will replace custom fetch logic, polling mechanisms, and manual caching with TanStack Query's declarative data-fetching paradigm.

**Current State:** Custom hooks with manual `fetch()` calls, polling via `setInterval`, and state management via `useState`/`useRef`.

**Target State:** TanStack Query for all server state, with automatic caching, background refetching, and simplified error/loading handling.

---

## Table of Contents

1. [Goals & Benefits](#1-goals--benefits)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [TanStack Query Setup](#3-tanstack-query-setup)
4. [Migration Phases](#4-migration-phases)
5. [Query & Mutation Specifications](#5-query--mutation-specifications)
6. [Polling Strategy](#6-polling-strategy)
7. [Cache Invalidation Strategy](#7-cache-invalidation-strategy)
8. [Error Handling](#8-error-handling)
9. [Testing Strategy](#9-testing-strategy)
10. [Rollback Plan](#10-rollback-plan)
11. [File Structure](#11-file-structure)
12. [Implementation Checklist](#12-implementation-checklist)

---

## 1. Goals & Benefits

### Primary Goals

1. **Eliminate manual polling logic** - Replace `setInterval` with `refetchInterval`
2. **Automatic caching** - Reduce redundant network requests
3. **Simplified loading/error states** - Use built-in `isLoading`, `isError`, `error`
4. **Better DevTools** - React Query DevTools for debugging
5. **Optimistic updates** - Instant UI feedback for mutations
6. **Request deduplication** - Prevent duplicate in-flight requests

### Expected Benefits

| Benefit | Current Pain Point | TanStack Query Solution |
|---------|-------------------|-------------------------|
| Reduced complexity | 2,687 lines across 11 custom hooks | Declarative queries with built-in state |
| Better caching | No caching, every fetch hits network | Stale-while-revalidate by default |
| Simplified polling | Manual `setInterval` + visibility handling | Built-in `refetchInterval` + `refetchOnWindowFocus` |
| Error retry | Manual retry logic | Automatic retry with exponential backoff |
| Loading states | Manual `useState` for each loading state | Built-in `isLoading`, `isFetching` |
| Request sequencing | Manual `messageLoadSeqRef` | Automatic request deduplication |

---

## 2. Current Architecture Analysis

### Hooks to Migrate

| Hook | File | Priority | Complexity |
|------|------|----------|------------|
| `useRepoData` | `/hooks/use-repo-data.ts` | P0 | High |
| `useCrossDeviceSync` | `/hooks/use-cross-device-sync.ts` | P0 | Medium |
| `useExecutionPolling` | `/components/chat/hooks/useExecutionPolling.ts` | P1 | High |
| `useBranchOperations` | `/hooks/use-branch-operations.ts` | P1 | Medium |
| `useSyncData` | `/hooks/use-sync-data.ts` | P0 | Medium |
| `useDraftSync` | `/components/chat/hooks/useDraftSync.ts` | P2 | Low |

### API Endpoints to Cover

#### Read Operations (Queries)
| Endpoint | Method | Current Hook | Polling |
|----------|--------|--------------|---------|
| `/api/user/me` | GET | `useRepoData` | No |
| `/api/sync` | GET | `useCrossDeviceSync` | 5s |
| `/api/agent/status` | POST | `useExecutionPolling` | 500ms |
| `/api/agent/execution/active` | GET | `useExecutionPolling` | On mount |
| `/api/branches/messages` | GET | `useRepoData.loadBranchMessages` | No |
| `/api/user/quota` | GET | `useRepoData.refreshQuota` | Manual |
| `/api/user/credentials` | GET | `useRepoData.refreshCredentials` | Manual |

#### Write Operations (Mutations)
| Endpoint | Method | Current Hook |
|----------|--------|--------------|
| `/api/branches` | PATCH | `useBranchOperations` |
| `/api/branches/messages` | POST | `useBranchOperations` |
| `/api/branches/messages` | PATCH | `useBranchOperations` |
| `/api/branches/draft` | PATCH | `useDraftSync` |
| `/api/repos` | POST/DELETE | `useRepoOperations` |

### Current Polling Mechanisms

```
┌─────────────────────────────────────────────────────────────────┐
│ useCrossDeviceSync                                              │
│ ├── Interval: 5000ms                                            │
│ ├── Visibility-aware: Pauses when tab hidden                    │
│ └── Endpoint: /api/sync                                         │
├─────────────────────────────────────────────────────────────────┤
│ useExecutionPolling                                             │
│ ├── Interval: 500ms (throttled server-side)                     │
│ ├── Condition: Only while execution is active                   │
│ ├── Visibility-aware: No (continues in background)              │
│ └── Endpoint: /api/agent/status                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. TanStack Query Setup

### Installation

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

### Provider Setup

**File:** `/app/providers.tsx` (new file)

```typescript
"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { useState } from "react"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Stale time: 30 seconds (data considered fresh)
            staleTime: 30 * 1000,
            // Cache time: 5 minutes (keep in cache after unmount)
            gcTime: 5 * 60 * 1000,
            // Retry failed requests 3 times
            retry: 3,
            // Refetch on window focus (good for cross-tab sync)
            refetchOnWindowFocus: true,
            // Don't refetch on mount if data is fresh
            refetchOnMount: true,
          },
          mutations: {
            // Retry mutations once
            retry: 1,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  )
}
```

**File:** `/app/layout.tsx` (update)

```typescript
import { QueryProvider } from "./providers"

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <SessionProvider>
          <QueryProvider>
            {children}
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
```

### Query Keys Factory

**File:** `/lib/api/query-keys.ts` (new file)

```typescript
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
```

---

## 4. Migration Phases

### Phase 1: Foundation (Week 1)

**Goal:** Set up TanStack Query infrastructure without breaking existing functionality.

1. Install TanStack Query and DevTools
2. Create `QueryProvider` wrapper
3. Create query keys factory
4. Create base API fetcher utilities
5. Add DevTools to development environment

**Deliverables:**
- [ ] Package installed
- [ ] Provider configured
- [ ] Query keys defined
- [ ] Base fetcher created
- [ ] DevTools working

### Phase 2: User Data Migration (Week 1-2)

**Goal:** Migrate `/api/user/me` and related endpoints.

**Current:** `useRepoData` hook fetches user data on mount.

**Target:** `useUserData` query with automatic caching.

```typescript
// Before (useRepoData)
useEffect(() => {
  fetch("/api/user/me")
    .then(res => res.json())
    .then(data => {
      setRepos(data.repos)
      setQuota(data.quota)
      setCredentials(data.credentials)
    })
}, [isAuthenticated])

// After (useUserData)
const { data, isLoading, error } = useQuery({
  queryKey: queryKeys.user.me(),
  queryFn: () => fetchUserData(),
  enabled: isAuthenticated,
  staleTime: 30 * 1000,
})
```

**Deliverables:**
- [ ] `useUserData` query hook created
- [ ] `useQuota` query hook created
- [ ] `useCredentials` query hook created
- [ ] Original `useRepoData` updated to use queries internally
- [ ] Loading states simplified

### Phase 3: Cross-Device Sync Migration (Week 2)

**Goal:** Replace `useCrossDeviceSync` polling with TanStack Query.

**Current:** Manual `setInterval` with visibility API handling.

**Target:** `useQuery` with `refetchInterval` and visibility-aware refetching.

```typescript
// Before (useCrossDeviceSync)
useEffect(() => {
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") {
      fetch("/api/sync").then(...)
    }
  }, 5000)
  return () => clearInterval(interval)
}, [])

// After
const { data } = useQuery({
  queryKey: queryKeys.sync.data(),
  queryFn: fetchSyncData,
  refetchInterval: 5000,
  refetchIntervalInBackground: false, // Pause when tab hidden
  refetchOnWindowFocus: true,
})
```

**Deliverables:**
- [ ] `useSyncDataQuery` hook created
- [ ] Visibility-aware polling configured
- [ ] Sync data change detection preserved
- [ ] Original hooks deprecated

### Phase 4: Branch Messages Migration (Week 2-3)

**Goal:** Migrate message loading to TanStack Query with infinite queries.

**Current:** Manual `loadBranchMessages` with request sequencing.

**Target:** `useInfiniteQuery` with automatic pagination.

```typescript
// Before
const loadBranchMessages = async (branchId) => {
  const seq = ++messageLoadSeqRef.current
  const res = await fetch(`/api/branches/messages?branchId=${branchId}`)
  if (seq !== messageLoadSeqRef.current) return // Stale request
  const data = await res.json()
  // Update state...
}

// After
const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: queryKeys.branches.messages(branchId),
  queryFn: ({ pageParam }) => fetchMessages(branchId, pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  enabled: !!branchId,
})
```

**Deliverables:**
- [ ] `useBranchMessages` infinite query created
- [ ] Request deduplication handled automatically
- [ ] Message summaries vs full content strategy preserved
- [ ] Loading states per branch

### Phase 5: Execution Polling Migration (Week 3-4)

**Goal:** Migrate execution polling while preserving streaming protection.

**Challenge:** Must prevent polling from overwriting streaming content.

**Approach:** Use conditional refetching with custom logic.

```typescript
const { data, refetch } = useQuery({
  queryKey: queryKeys.execution.status(executionId),
  queryFn: () => fetchExecutionStatus(executionId),
  enabled: !!executionId && isPollingActive,
  refetchInterval: (data) => {
    // Stop polling when execution complete
    if (data?.status === "completed" || data?.status === "error") {
      return false
    }
    return 500 // 500ms polling
  },
  // Custom select to merge with streaming content
  select: (data) => mergeWithStreamingContent(data, streamingMessageRef.current),
})
```

**Deliverables:**
- [ ] `useExecutionStatus` query created
- [ ] Streaming content protection preserved
- [ ] Commit detection logic migrated
- [ ] Loop mode continuation supported
- [ ] Resume on page refresh working

### Phase 6: Mutations Migration (Week 4)

**Goal:** Migrate all write operations to `useMutation`.

**Mutations to create:**
1. `useUpdateBranch` - Update branch metadata
2. `useAddMessage` - Add new message
3. `useUpdateMessage` - Update existing message
4. `useSaveDraft` - Save draft prompt
5. `useDeleteRepo` - Delete repository
6. `useCreateBranch` - Create new branch

```typescript
const updateBranch = useMutation({
  mutationFn: (updates: BranchUpdate) =>
    fetch("/api/branches", {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),
  onMutate: async (updates) => {
    // Optimistic update
    await queryClient.cancelQueries({ queryKey: queryKeys.branches.detail(updates.id) })
    const previous = queryClient.getQueryData(queryKeys.branches.detail(updates.id))
    queryClient.setQueryData(queryKeys.branches.detail(updates.id), (old) => ({
      ...old,
      ...updates,
    }))
    return { previous }
  },
  onError: (err, updates, context) => {
    // Rollback on error
    queryClient.setQueryData(queryKeys.branches.detail(updates.id), context?.previous)
  },
  onSettled: () => {
    // Invalidate to refetch
    queryClient.invalidateQueries({ queryKey: queryKeys.branches.all })
  },
})
```

**Deliverables:**
- [ ] All mutation hooks created
- [ ] Optimistic updates implemented
- [ ] Error rollback working
- [ ] Cache invalidation configured

### Phase 7: Cleanup & Optimization (Week 5)

**Goal:** Remove legacy code, optimize bundle size, document patterns.

1. Remove deprecated hooks
2. Remove manual loading/error states
3. Optimize query configurations
4. Add comprehensive error boundaries
5. Document new patterns

**Deliverables:**
- [ ] Legacy hooks removed
- [ ] Bundle size reduced
- [ ] Documentation updated
- [ ] Team trained on new patterns

---

## 5. Query & Mutation Specifications

### Queries

#### `useUserData`
```typescript
// Query: Fetch current user with repos, quota, credentials
useQuery({
  queryKey: queryKeys.user.me(),
  queryFn: async () => {
    const res = await fetch("/api/user/me", { cache: "no-store" })
    if (!res.ok) throw new Error("Failed to fetch user data")
    return res.json() as Promise<UserData>
  },
  enabled: isAuthenticated,
  staleTime: 30 * 1000,
  refetchOnWindowFocus: true,
})
```

#### `useSyncData`
```typescript
// Query: Cross-device sync polling
useQuery({
  queryKey: queryKeys.sync.data(),
  queryFn: async () => {
    const res = await fetch("/api/sync")
    if (!res.ok) throw new Error("Sync failed")
    return res.json() as Promise<SyncData>
  },
  refetchInterval: 5000,
  refetchIntervalInBackground: false,
  staleTime: 4000, // Slightly less than refetch interval
})
```

#### `useBranchMessages`
```typescript
// Infinite Query: Paginated messages
useInfiniteQuery({
  queryKey: queryKeys.branches.messages(branchId),
  queryFn: async ({ pageParam = null }) => {
    const params = new URLSearchParams({ branchId })
    if (pageParam) params.set("cursor", pageParam)
    const res = await fetch(`/api/branches/messages?${params}`)
    return res.json() as Promise<MessagesPage>
  },
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  enabled: !!branchId,
  staleTime: 0, // Always refetch messages
})
```

#### `useExecutionStatus`
```typescript
// Query: Execution polling with conditional interval
useQuery({
  queryKey: queryKeys.execution.status(executionId),
  queryFn: async () => {
    const res = await fetch("/api/agent/status", {
      method: "POST",
      body: JSON.stringify({ executionId }),
    })
    return res.json() as Promise<ExecutionStatus>
  },
  enabled: !!executionId,
  refetchInterval: (data) => {
    if (!data) return 500
    if (data.status === "completed" || data.status === "error") return false
    return 500
  },
  retry: 10, // Match MAX_NOT_FOUND_RETRIES
})
```

### Mutations

#### `useUpdateBranch`
```typescript
useMutation({
  mutationFn: async (update: { branchId: string; data: Partial<Branch> }) => {
    const res = await fetch("/api/branches", {
      method: "PATCH",
      body: JSON.stringify({ branchId: update.branchId, ...update.data }),
    })
    if (!res.ok) throw new Error("Failed to update branch")
    return res.json()
  },
  onSuccess: (_, variables) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.branches.detail(variables.branchId) })
    queryClient.invalidateQueries({ queryKey: queryKeys.sync.data() })
  },
})
```

#### `useAddMessage`
```typescript
useMutation({
  mutationFn: async (data: { branchId: string; message: Omit<Message, "id"> }) => {
    const res = await fetch("/api/branches/messages", {
      method: "POST",
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error("Failed to add message")
    return res.json() as Promise<{ id: string }>
  },
  onSuccess: (result, variables) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.branches.messages(variables.branchId)
    })
  },
})
```

---

## 6. Polling Strategy

### Polling Configuration Matrix

| Data Type | Interval | Background | Window Focus | Stale Time |
|-----------|----------|------------|--------------|------------|
| User data | None | N/A | Refetch | 30s |
| Sync data | 5000ms | No | Refetch | 4s |
| Execution status | 500ms | Yes | No | 0 |
| Messages | None | N/A | No | 0 |
| Quota | None | N/A | Refetch | 60s |

### Visibility-Aware Polling

TanStack Query handles visibility automatically with `refetchIntervalInBackground: false`.

```typescript
// Sync polling pauses when tab is hidden
useQuery({
  queryKey: queryKeys.sync.data(),
  queryFn: fetchSyncData,
  refetchInterval: 5000,
  refetchIntervalInBackground: false, // Key setting
})
```

### Conditional Polling

For execution status, polling should stop when execution completes:

```typescript
useQuery({
  queryKey: queryKeys.execution.status(executionId),
  queryFn: fetchExecutionStatus,
  refetchInterval: (data) => {
    // Return false to stop polling
    if (data?.status === "completed") return false
    if (data?.status === "error") return false
    return 500 // Continue polling
  },
})
```

---

## 7. Cache Invalidation Strategy

### Invalidation Triggers

| Event | Queries to Invalidate |
|-------|----------------------|
| New message added | `branches.messages(branchId)` |
| Branch updated | `branches.detail(branchId)`, `sync.data()` |
| Repo deleted | `repos.all`, `user.me()` |
| Execution started | `execution.status(executionId)` |
| Execution completed | `branches.messages(branchId)`, `branches.detail(branchId)` |
| User settings changed | `user.me()`, `user.credentials()` |

### Invalidation Patterns

```typescript
// After adding a message
queryClient.invalidateQueries({
  queryKey: queryKeys.branches.messages(branchId)
})

// After deleting a repo
queryClient.invalidateQueries({
  queryKey: queryKeys.repos.all
})
queryClient.invalidateQueries({
  queryKey: queryKeys.user.me()
})

// After execution completes - invalidate all related data
queryClient.invalidateQueries({
  queryKey: queryKeys.branches.detail(branchId)
})
queryClient.invalidateQueries({
  queryKey: queryKeys.branches.messages(branchId)
})
```

### Optimistic Updates

For responsive UI, use optimistic updates with rollback:

```typescript
const updateBranch = useMutation({
  mutationFn: updateBranchApi,
  onMutate: async (newData) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: queryKeys.branches.detail(newData.id) })

    // Snapshot previous value
    const previousBranch = queryClient.getQueryData(queryKeys.branches.detail(newData.id))

    // Optimistically update
    queryClient.setQueryData(queryKeys.branches.detail(newData.id), (old) => ({
      ...old,
      ...newData,
    }))

    return { previousBranch }
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(
      queryKeys.branches.detail(newData.id),
      context?.previousBranch
    )
  },
  onSettled: (data, error, variables) => {
    // Always refetch to ensure consistency
    queryClient.invalidateQueries({ queryKey: queryKeys.branches.detail(variables.id) })
  },
})
```

---

## 8. Error Handling

### Global Error Handler

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false
        }
        return failureCount < 3
      },
      onError: (error) => {
        // Global error logging
        console.error("Query error:", error)
        // Could send to error tracking service
      },
    },
    mutations: {
      onError: (error) => {
        console.error("Mutation error:", error)
        // Show toast notification
        toast.error("Operation failed. Please try again.")
      },
    },
  },
})
```

### Error Boundaries

```typescript
// Component-level error handling
function BranchMessagesPanel({ branchId }: { branchId: string }) {
  const { data, error, isError } = useQuery({
    queryKey: queryKeys.branches.messages(branchId),
    queryFn: () => fetchMessages(branchId),
  })

  if (isError) {
    return <ErrorFallback error={error} onRetry={() => refetch()} />
  }

  return <MessageList messages={data?.messages} />
}
```

### API Error Types

```typescript
// lib/api/errors.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message)
    this.name = "ApiError"
  }
}

// Usage in fetch wrapper
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new ApiError(error.message, res.status, error.code)
  }

  return res.json()
}
```

---

## 9. Testing Strategy

### Unit Tests

```typescript
// Example: Testing useUserData hook
import { renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useUserData } from "./useUserData"

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

test("fetches user data on mount", async () => {
  // Mock fetch
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ user: { id: "1" }, repos: [] }),
  })

  const { result } = renderHook(() => useUserData(), { wrapper: createWrapper() })

  await waitFor(() => expect(result.current.isSuccess).toBe(true))

  expect(result.current.data?.user.id).toBe("1")
})
```

### Integration Tests

```typescript
// Test polling behavior
test("sync polling pauses when tab hidden", async () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: () => ({}) })
  global.fetch = fetchMock

  renderHook(() => useSyncData(), { wrapper: createWrapper() })

  // Wait for initial fetch
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

  // Simulate tab hidden
  Object.defineProperty(document, "visibilityState", { value: "hidden" })
  document.dispatchEvent(new Event("visibilitychange"))

  // Wait for polling interval
  await new Promise((r) => setTimeout(r, 6000))

  // Should not have polled while hidden
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
```

---

## 10. Rollback Plan

### Feature Flags

Use feature flags to gradually roll out TanStack Query:

```typescript
// lib/feature-flags.ts
export const FEATURES = {
  USE_TANSTACK_QUERY: process.env.NEXT_PUBLIC_USE_TANSTACK_QUERY === "true",
  USE_TQ_SYNC: process.env.NEXT_PUBLIC_USE_TQ_SYNC === "true",
  USE_TQ_EXECUTION: process.env.NEXT_PUBLIC_USE_TQ_EXECUTION === "true",
}

// Usage in hook
export function useSyncData() {
  if (FEATURES.USE_TQ_SYNC) {
    return useSyncDataTQ() // New TanStack Query version
  }
  return useSyncDataLegacy() // Original implementation
}
```

### Rollback Steps

If issues arise:

1. **Immediate:** Set feature flag to `false` in environment
2. **Short-term:** Revert to legacy hooks (preserved during migration)
3. **Long-term:** Fix issues in TanStack Query implementation

### Preserving Legacy Code

During migration, keep original hooks with a `Legacy` suffix:

```
hooks/
├── use-repo-data.ts          # New TanStack Query version
├── use-repo-data.legacy.ts   # Original implementation (preserved)
└── use-repo-data.bridge.ts   # Bridge that chooses based on feature flag
```

---

## 11. File Structure

### New Files to Create

```
packages/web/
├── app/
│   └── providers.tsx                    # QueryClientProvider setup
│
├── lib/
│   └── api/
│       ├── query-keys.ts               # Query key factory
│       ├── fetcher.ts                  # Base fetch wrapper
│       ├── errors.ts                   # API error types
│       │
│       ├── queries/
│       │   ├── useUserData.ts          # User data query
│       │   ├── useSyncData.ts          # Cross-device sync query
│       │   ├── useBranchMessages.ts    # Messages infinite query
│       │   ├── useExecutionStatus.ts   # Execution polling query
│       │   ├── useQuota.ts             # User quota query
│       │   └── useCredentials.ts       # User credentials query
│       │
│       └── mutations/
│           ├── useUpdateBranch.ts      # Branch update mutation
│           ├── useAddMessage.ts        # Add message mutation
│           ├── useUpdateMessage.ts     # Update message mutation
│           ├── useSaveDraft.ts         # Save draft mutation
│           ├── useCreateBranch.ts      # Create branch mutation
│           └── useDeleteRepo.ts        # Delete repo mutation
│
└── hooks/
    ├── use-repo-data.ts                # Updated to use queries
    ├── use-repo-data.legacy.ts         # Original (preserved)
    ├── use-cross-device-sync.ts        # Updated to use queries
    ├── use-cross-device-sync.legacy.ts # Original (preserved)
    └── ...
```

### Files to Modify

| File | Changes |
|------|---------|
| `/app/layout.tsx` | Add `QueryProvider` wrapper |
| `/app/page.tsx` | Simplify state, use new hooks |
| `/hooks/use-repo-data.ts` | Rewrite using `useUserData` query |
| `/hooks/use-cross-device-sync.ts` | Rewrite using `useSyncData` query |
| `/hooks/use-branch-operations.ts` | Rewrite using mutations |
| `/components/chat/hooks/useExecutionPolling.ts` | Rewrite using `useExecutionStatus` |
| `/components/chat/hooks/useDraftSync.ts` | Rewrite using `useSaveDraft` mutation |

---

## 12. Implementation Checklist

### Phase 1: Foundation
- [ ] Install `@tanstack/react-query` and `@tanstack/react-query-devtools`
- [ ] Create `/app/providers.tsx` with `QueryClientProvider`
- [ ] Update `/app/layout.tsx` to wrap app with `QueryProvider`
- [ ] Create `/lib/api/query-keys.ts` with query key factory
- [ ] Create `/lib/api/fetcher.ts` with base fetch wrapper
- [ ] Create `/lib/api/errors.ts` with `ApiError` class
- [ ] Verify DevTools appear in development

### Phase 2: User Data
- [ ] Create `useUserData` query hook
- [ ] Create `useQuota` query hook
- [ ] Create `useCredentials` query hook
- [ ] Update `useRepoData` to use new queries internally
- [ ] Test loading states work correctly
- [ ] Test error handling works correctly

### Phase 3: Cross-Device Sync
- [ ] Create `useSyncData` query hook with `refetchInterval: 5000`
- [ ] Verify `refetchIntervalInBackground: false` pauses when hidden
- [ ] Migrate change detection logic from `useSyncData`
- [ ] Update `useCrossDeviceSync` to use new query
- [ ] Test multi-tab sync still works

### Phase 4: Branch Messages
- [ ] Create `useBranchMessages` infinite query hook
- [ ] Implement pagination with `getNextPageParam`
- [ ] Migrate message summary vs full content logic
- [ ] Update components to use new hook
- [ ] Test message loading performance

### Phase 5: Execution Polling
- [ ] Create `useExecutionStatus` query hook
- [ ] Implement conditional polling (stop on complete/error)
- [ ] Preserve streaming content protection
- [ ] Migrate commit detection logic
- [ ] Test loop mode continuation
- [ ] Test resume on page refresh

### Phase 6: Mutations
- [ ] Create `useUpdateBranch` mutation
- [ ] Create `useAddMessage` mutation
- [ ] Create `useUpdateMessage` mutation
- [ ] Create `useSaveDraft` mutation
- [ ] Create `useDeleteRepo` mutation
- [ ] Create `useCreateBranch` mutation
- [ ] Implement optimistic updates where appropriate
- [ ] Test error rollback works

### Phase 7: Cleanup
- [ ] Remove legacy hook files (after validation period)
- [ ] Remove manual loading state management
- [ ] Remove manual error state management
- [ ] Update documentation
- [ ] Remove feature flags
- [ ] Final bundle size check

---

## Appendix: Code Examples

### A. Complete `useUserData` Implementation

```typescript
// lib/api/queries/useUserData.ts
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../query-keys"
import { apiFetch } from "../fetcher"
import type { UserData } from "@/lib/shared/types"

export function useUserData() {
  const { status } = useSession()
  const isAuthenticated = status === "authenticated"

  return useQuery({
    queryKey: queryKeys.user.me(),
    queryFn: () => apiFetch<UserData>("/api/user/me"),
    enabled: isAuthenticated,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    select: (data) => ({
      user: data.user,
      repos: data.repos,
      quota: data.quota,
      credentials: data.credentials,
      isAdmin: data.user?.isAdmin ?? false,
    }),
  })
}

// Hook to refresh specific parts
export function useRefreshUserData() {
  const queryClient = useQueryClient()

  return {
    refreshAll: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.me() }),
    refreshQuota: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.quota() }),
    refreshCredentials: () => queryClient.invalidateQueries({ queryKey: queryKeys.user.credentials() }),
  }
}
```

### B. Complete `useSyncData` Implementation

```typescript
// lib/api/queries/useSyncData.ts
import { useQuery } from "@tanstack/react-query"
import { useRef, useCallback } from "react"
import { queryKeys } from "../query-keys"
import { apiFetch } from "../fetcher"
import type { SyncData } from "@/lib/shared/types"

export function useSyncData(options?: {
  onSyncData?: (data: SyncData, prevData: SyncData | null) => void
  enabled?: boolean
}) {
  const prevDataRef = useRef<SyncData | null>(null)

  const query = useQuery({
    queryKey: queryKeys.sync.data(),
    queryFn: async () => {
      const data = await apiFetch<SyncData>("/api/sync")

      // Call handler with previous data for comparison
      if (options?.onSyncData) {
        options.onSyncData(data, prevDataRef.current)
      }
      prevDataRef.current = data

      return data
    },
    enabled: options?.enabled ?? true,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    staleTime: 4000,
  })

  const manualSync = useCallback(() => {
    query.refetch()
  }, [query])

  return {
    ...query,
    sync: manualSync,
  }
}
```

### C. Complete `useExecutionStatus` Implementation

```typescript
// lib/api/queries/useExecutionStatus.ts
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useCallback } from "react"
import { queryKeys } from "../query-keys"
import { apiFetch } from "../fetcher"
import type { ExecutionStatus } from "@/lib/shared/types"

interface UseExecutionStatusOptions {
  executionId: string | null
  messageId: string | null
  onStatusUpdate?: (status: ExecutionStatus) => void
  onComplete?: (status: ExecutionStatus) => void
  streamingMessageId?: string | null
}

export function useExecutionStatus(options: UseExecutionStatusOptions) {
  const { executionId, messageId, onStatusUpdate, onComplete, streamingMessageId } = options
  const queryClient = useQueryClient()
  const completedRef = useRef(false)

  const query = useQuery({
    queryKey: queryKeys.execution.status(executionId ?? ""),
    queryFn: async () => {
      const status = await apiFetch<ExecutionStatus>("/api/agent/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId }),
      })

      // Call update handler
      onStatusUpdate?.(status)

      // Check for completion
      if (status.status === "completed" || status.status === "error") {
        if (!completedRef.current) {
          completedRef.current = true
          onComplete?.(status)
        }
      }

      return status
    },
    enabled: !!executionId,
    refetchInterval: (data) => {
      if (!data) return 500
      if (data.status === "completed" || data.status === "error") {
        return false // Stop polling
      }
      return 500 // Continue polling every 500ms
    },
    retry: 10, // Match MAX_NOT_FOUND_RETRIES
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  })

  const startPolling = useCallback((newExecutionId: string, newMessageId: string) => {
    completedRef.current = false
    // Update the query key to start polling new execution
    queryClient.invalidateQueries({ queryKey: queryKeys.execution.status(newExecutionId) })
  }, [queryClient])

  const stopPolling = useCallback(() => {
    // Disable the query by setting executionId to null (handled by enabled flag)
  }, [])

  return {
    ...query,
    startPolling,
    stopPolling,
    isPolling: query.isFetching && !completedRef.current,
  }
}
```

---

## Summary

This migration plan provides a comprehensive roadmap for adopting TanStack Query in your application. The phased approach allows for incremental adoption with minimal risk, while the feature flag system enables easy rollback if issues arise.

**Key success metrics:**
- Reduced custom hook complexity (target: 50% reduction in lines of code)
- Eliminated manual polling logic
- Improved caching (reduced API calls by 30-50%)
- Better error handling with automatic retries
- Enhanced DevTools for debugging

**Estimated timeline:** 5 weeks for full migration

**Team requirements:** 1-2 developers familiar with React Query patterns
