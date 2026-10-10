"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "next-auth/react"
import { queryKeys } from "../keys"
import { fetchChats, toChatType } from "@/lib/sync/api"
import type { Chat } from "@/lib/types"
import { applyQueueSnapshot, loadQueueMessages, needsChatListMessages, snapshotFailure } from "@/lib/queue-sync"

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
      const snapshots = await Promise.all(serverChats.map(async (serverChat) => {
        const chat = toChatType(serverChat)
        const prev = previousById.get(chat.id)
        try {
          return { chat, detail: needsChatListMessages(prev, chat) ? await loadQueueMessages(chat.id) : undefined, detailFailed: false }
        } catch (error) {
          // One deleted/stale chat or a transient detail failure must not hide
          // every other chat. Keep its previous snapshot and retry next poll.
          console.error(`Failed to refresh messages for ${chat.id}:`, error)
          return { chat, detail: undefined, detailFailed: true }
        }
      }))
      // Read the cache after ALL detail requests finish. Another chat's slow
      // response must not roll back the active chat's newer streaming state.
      const latestById = new Map(queryClient.getQueryData<Chat[]>(queryKeys.chats.list())?.map((chat) => [chat.id, chat]) ?? [])
      return snapshots.map(({ chat, detail, detailFailed }) => {
        const latest = latestById.get(chat.id)
        if (!latest) return chat
        if (detailFailed) return latest
        if ((detail?.updatedAt ?? chat.updatedAt) < latest.updatedAt) return latest
        return applyQueueSnapshot({
          ...chat, messages: latest.messages, pendingSend: latest.pendingSend, stopPending: latest.stopPending,
          pendingSendAssistantMessageId: latest.pendingSendAssistantMessageId,
          status: latest.pendingSend ? latest.status : chat.status,
          activeAssistantMessageId: latest.pendingSend ? latest.activeAssistantMessageId : chat.activeAssistantMessageId,
          ...snapshotFailure(latest, detail ?? chat),
          recoverableAssistantMessageId: (detail?.updatedAt ?? chat.updatedAt) === latest.updatedAt ? latest.recoverableAssistantMessageId : undefined,
        }, {
          ...chat, queuePaused: !!chat.queuePaused, queuedMessages: chat.queuedMessages ?? [],
          backgroundSessionId: chat.backgroundSessionId ?? null, activeAssistantMessageId: chat.activeAssistantMessageId ?? null,
        }, detail)
      })
    },
    enabled: isAuthenticated,
    staleTime: 30 * 1000, // 30 seconds
  })
}
