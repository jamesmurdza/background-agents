/**
 * TanStack Query API Layer
 *
 * This module exports query keys and fetcher utilities.
 * Query hooks are defined directly in the hooks/ directory for now.
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
