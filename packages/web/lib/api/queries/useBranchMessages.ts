"use client"

import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { queryKeys } from "../query-keys"
import { apiFetch } from "../fetcher"
import { DbMessage, transformMessage } from "@/lib/db/db-types"
import type { Message } from "@/lib/shared/types"

/**
 * Response shape from /api/branches/messages
 */
interface MessagesResponse {
  messages: DbMessage[]
  nextCursor?: string
  hasMore?: boolean
}

/**
 * Transformed messages page
 */
interface MessagesPage {
  messages: Message[]
  nextCursor?: string
  hasMore: boolean
}

/**
 * Fetch messages for a branch
 */
async function fetchBranchMessages(
  branchId: string,
  cursor?: string,
  summary: boolean = false
): Promise<MessagesPage> {
  const params = new URLSearchParams({ branchId })
  if (cursor) params.set("cursor", cursor)
  if (summary) params.set("summary", "true")

  const data = await apiFetch<MessagesResponse>(
    `/api/branches/messages?${params.toString()}`
  )

  return {
    messages: data.messages.map(transformMessage),
    nextCursor: data.nextCursor,
    hasMore: data.hasMore ?? false,
  }
}

/**
 * Hook to fetch all messages for a branch (non-paginated)
 *
 * Use this when you need all messages at once (e.g., for the chat display).
 */
export function useBranchMessages(branchId: string | null) {
  return useQuery({
    queryKey: branchId ? queryKeys.branches.messages(branchId) : ["disabled"],
    queryFn: () => fetchBranchMessages(branchId!),
    enabled: !!branchId,
    staleTime: 0, // Messages can change frequently
    refetchOnWindowFocus: false, // Don't refetch on focus - let sync handle it
  })
}

/**
 * Hook to fetch messages with pagination (infinite query)
 *
 * Use this for large message histories where pagination is needed.
 */
export function useBranchMessagesInfinite(branchId: string | null) {
  return useInfiniteQuery({
    queryKey: branchId ? [...queryKeys.branches.messages(branchId), "infinite"] : ["disabled"],
    queryFn: ({ pageParam }) => fetchBranchMessages(branchId!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!branchId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * Hook to prefetch messages for a branch
 */
export function usePrefetchBranchMessages() {
  const queryClient = useQueryClient()

  return (branchId: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.branches.messages(branchId),
      queryFn: () => fetchBranchMessages(branchId),
    })
  }
}

/**
 * Hook to update messages in the cache
 */
export function useUpdateBranchMessagesCache() {
  const queryClient = useQueryClient()

  return {
    /**
     * Add a message to the cache
     */
    addMessage: (branchId: string, message: Message) => {
      queryClient.setQueryData<MessagesPage>(
        queryKeys.branches.messages(branchId),
        (old) => {
          if (!old) return { messages: [message], hasMore: false }
          return {
            ...old,
            messages: [...old.messages, message],
          }
        }
      )
    },

    /**
     * Update a message in the cache
     */
    updateMessage: (branchId: string, messageId: string, updates: Partial<Message>) => {
      queryClient.setQueryData<MessagesPage>(
        queryKeys.branches.messages(branchId),
        (old) => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map((m) =>
              m.id === messageId ? { ...m, ...updates } : m
            ),
          }
        }
      )
    },

    /**
     * Invalidate messages cache to trigger refetch
     */
    invalidate: (branchId: string) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.branches.messages(branchId),
      })
    },

    /**
     * Set all messages for a branch
     */
    setMessages: (branchId: string, messages: Message[]) => {
      queryClient.setQueryData<MessagesPage>(
        queryKeys.branches.messages(branchId),
        { messages, hasMore: false }
      )
    },
  }
}
