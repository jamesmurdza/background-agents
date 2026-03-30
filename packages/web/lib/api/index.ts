/**
 * TanStack Query API Layer
 *
 * This module exports all queries and mutations for the application.
 * Use these hooks instead of direct fetch calls for automatic caching,
 * background refetching, and optimistic updates.
 */

// Query Keys
export { queryKeys } from "./query-keys"
export type {
  QueryKeys,
  UserQueryKey,
  SyncQueryKey,
  ExecutionStatusQueryKey,
  BranchMessagesQueryKey,
} from "./query-keys"

// Fetcher utilities
export { apiFetch, apiPost, apiPatch, apiDelete } from "./fetcher"

// Error handling
export { ApiError, isApiError, getErrorMessage } from "./errors"

// User Data Queries
export {
  useUserData,
  useQuota,
  useCredentials,
  useRepos,
  useRefreshUserData,
  getUserDataFromCache,
} from "./queries/useUserData"
export type { UserData } from "./queries/useUserData"

// Sync Queries
export {
  useSyncData,
  useManualSync,
} from "./queries/useSyncData"
export type { SyncData, SyncRepo, SyncBranch } from "./queries/useSyncData"

// Branch Messages Queries
export {
  useBranchMessages,
  useBranchMessagesInfinite,
  usePrefetchBranchMessages,
  useUpdateBranchMessagesCache,
} from "./queries/useBranchMessages"

// Execution Status Queries
export {
  useExecutionStatus,
  useActiveExecution,
  useInvalidateExecution,
} from "./queries/useExecutionStatus"
export type {
  ExecutionStatusResponse,
  ActiveExecutionResponse,
} from "./queries/useExecutionStatus"

// Branch Mutations
export {
  useUpdateBranch,
  useSaveDraft,
} from "./mutations/useUpdateBranch"

// Message Mutations
export {
  useAddMessage,
  useUpdateMessage,
  useOptimisticAddMessage,
} from "./mutations/useMessages"

// Repo Mutations
export {
  useCreateRepo,
  useDeleteRepo,
  useUpdateRepoOrder,
} from "./mutations/useRepos"

// Branch Mutations
export {
  useCreateBranch,
  useDeleteBranch,
  useRenameBranch,
} from "./mutations/useBranches"
