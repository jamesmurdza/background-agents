"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { fetchChats, toChatType } from "@/lib/sync/api"
import type { Chat } from "@/lib/types"

/**
 * Fetches the list of all chats for the current user.
 * Only enabled when the user is authenticated.
 */
export function useChatsQuery() {
  const { data: session, status } = useSession()
  const queryClient = useQueryClient()
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.chats.list(),
    queryFn: async (): Promise<Chat[]> => {
      const serverChats = await fetchChats()
      // The list endpoint never returns messages (toChatType sets messages: []).
      // Messages are loaded lazily and stored back into this list cache. If we
      // blindly overwrote the cache on every refetch we'd wipe those loaded
      // messages, causing the open chat to reload (a visible flash, e.g. right
      // after deleting a chat triggers an invalidation). Preserve any messages
      // we've already loaded for chats that still exist.
      const previous = queryClient.getQueryData<Chat[]>(queryKeys.chats.list())
      const previousById = new Map(previous?.map((c) => [c.id, c]) ?? [])
      return serverChats.map((serverChat) => {
        const chat = toChatType(serverChat)
        const prev = previousById.get(chat.id)
        if (prev && prev.messages.length > 0) {
          return { ...chat, messages: prev.messages }
        }
        return chat
      })
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
  })
}
