"use client"

/**
 * Message fetching/merging for {@link useChatWithSync}.
 *
 * The chat-list endpoint doesn't include message bodies, so messages are loaded
 * lazily: once when a chat is selected, and on demand after server-side events
 * (git operations, a dropped SSE stream). This hook owns that family of
 * fetch-and-merge-into-cache operations so the main hook doesn't have to.
 *
 * All merges go through the shared TanStack Query cache via `updateChatsCache`;
 * `mergeMessages` reconciles optimistic/streamed copies with the persisted ones.
 */

import { useCallback, useEffect, useRef } from "react"
import type { Chat, Message } from "@/lib/types"
import { fetchChat, toMessageType } from "@/lib/sync/api"
import { mergeMessages } from "./useStreaming"

interface UseChatMessageSyncArgs {
  chats: Chat[]
  currentChatId: string | null
  isHydrated: boolean
  updateChatsCache: (updater: (chats: Chat[]) => Chat[]) => void
}

export interface ChatMessageSync {
  reloadMessages: (chatId: string) => Promise<void>
  refetchMessages: (chatId: string) => Promise<void>
  reloadChat: (chatId: string) => Promise<void>
  addMessageToChat: (chatId: string, message: Message) => void
}

export function useChatMessageSync({
  chats,
  currentChatId,
  isHydrated,
  updateChatsCache,
}: UseChatMessageSyncArgs): ChatMessageSync {
  const messagesLoadFailed = useRef<Set<string>>(new Set())
  
  const fullyLoaded = useRef<Set<string>>(new Set())

  // Load messages for current chat when selected
  useEffect(() => {
    if (!currentChatId || !isHydrated) return

    const chat = chats.find((c) => c.id === currentChatId)
    if (!chat) return

    // Skip if we've already fetched this chat or a previous load failed.
    if (fullyLoaded.current.has(currentChatId) || messagesLoadFailed.current.has(currentChatId)) {
      return
    }

    const inheritedLoaded = chat.messages.some((m) => m.inherited)
    const alreadyLoaded =
      chat.messages.length > 0 && (!chat.parentChatId || inheritedLoaded)
    if (alreadyLoaded) {
      fullyLoaded.current.add(currentChatId)
      return
    }

    const loadMessages = async () => {
      try {
        const chatData = await fetchChat(currentChatId)
        const incomingMessages = chatData.messages.map(toMessageType)

        updateChatsCache((old) =>
          old.map((c) => {
            if (c.id !== currentChatId) return c
            return {
              ...c,
              messages: mergeMessages(c.messages, incomingMessages),
              messageCount: chatData.messageCount,
            }
          })
        )
        // Mark loaded even when the parent had no displayable messages, so we
        // don't re-fetch on every render (this effect re-runs whenever `chats`
        // changes, e.g. during streaming).
        fullyLoaded.current.add(currentChatId)
      } catch (err) {
        console.error("Failed to load chat messages:", err)
        messagesLoadFailed.current.add(currentChatId)
      }
    }

    loadMessages()
  }, [currentChatId, chats, isHydrated, updateChatsCache])

  // Force a re-fetch of a chat's messages (e.g. after the server appends a
  // git-operation message). Unlike the load-on-select effect this has no
  // "already loaded" guard.
  const reloadMessages = useCallback(async (chatId: string) => {
    try {
      const chatData = await fetchChat(chatId)
      const incomingMessages = chatData.messages.map(toMessageType)
      updateChatsCache((old) =>
        old.map((c) =>
          c.id === chatId
            ? { ...c, messages: mergeMessages(c.messages, incomingMessages), messageCount: chatData.messageCount }
            : c
        )
      )
    } catch (err) {
      console.error("Failed to reload chat messages:", err)
    }
  }, [updateChatsCache])

  // Append a message into the cached chat without going through the server.
  // Used by callers that have already produced a system message client-side.
  const addMessageToChat = useCallback((chatId: string, message: Message) => {
    updateChatsCache((old) => old.map((c) => c.id === chatId ? { ...c, messages: [...c.messages, message] } : c))
  }, [updateChatsCache])

  // Refetch messages for a specific chat (used after git operations add messages on backend)
  // Uses delta sync - only fetches messages after the last known message ID
  const refetchMessages = useCallback(async (chatId: string) => {
    try {
      // Find the last message ID for this chat to enable delta sync
      const chat = chats.find((c) => c.id === chatId)
      const lastMessageId = chat?.messages[chat.messages.length - 1]?.id

      // Fetch only new messages (after lastMessageId)
      const chatData = await fetchChat(chatId, lastMessageId ? { afterMessageId: lastMessageId } : undefined)
      const incomingMessages = chatData.messages.map(toMessageType)

      if (incomingMessages.length > 0) {
        updateChatsCache((old) =>
          old.map((c) => {
            if (c.id !== chatId) return c
            return { ...c, messages: mergeMessages(c.messages, incomingMessages) }
          })
        )
      }
    } catch (err) {
      console.error("Failed to refetch messages:", err)
    }
  }, [chats, updateChatsCache])

  // Reload a chat's full history after the SSE stream died ("disconnected").
  // Unlike refetchMessages (delta sync), this re-fetches the entire history so a
  // partially-streamed assistant turn is replaced by the fuller persisted copy
  // (mergeMessages prefers the message with more content), then clears the
  // disconnected banner so the user can continue.
  const reloadChat = useCallback(async (chatId: string) => {
    try {
      const chatData = await fetchChat(chatId)
      const incomingMessages = chatData.messages.map(toMessageType)
      updateChatsCache((old) =>
        old.map((c) => {
          if (c.id !== chatId) return c
          return {
            ...c,
            messages: incomingMessages.length > 0
              ? mergeMessages(c.messages, incomingMessages)
              : c.messages,
            status: "ready",
            errorMessage: undefined,
          }
        })
      )
    } catch (err) {
      console.error("Failed to reload chat:", err)
    }
  }, [updateChatsCache])

  return { reloadMessages, refetchMessages, reloadChat, addMessageToChat }
}
