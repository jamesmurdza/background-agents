"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "../keys"

export interface SharedChatInfo {
  id: string
  displayName: string | null
  shareId: string
  createdAt: string
}

/**
 * The user's chats that currently have an active public share link.
 * Powers Settings → Shared Links.
 */
export function useSharedChatsQuery() {
  return useQuery({
    queryKey: queryKeys.chats.shared(),
    queryFn: async (): Promise<{ chats: SharedChatInfo[] }> => {
      const res = await fetch("/api/chats/shared")
      if (!res.ok) throw new Error(`Failed to load shared chats: ${res.status}`)
      return res.json()
    },
    staleTime: 30 * 1000,
  })
}
