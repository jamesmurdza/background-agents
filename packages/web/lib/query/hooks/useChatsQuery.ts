"use client"

import { useQuery } from "@tanstack/react-query"
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
  const isAuthenticated = status === "authenticated" && !!session?.user?.id

  return useQuery({
    queryKey: queryKeys.chats.list(),
    queryFn: async (): Promise<Chat[]> => {
      const serverChats = await fetchChats()
      return serverChats.map(toChatType)
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
  })
}
