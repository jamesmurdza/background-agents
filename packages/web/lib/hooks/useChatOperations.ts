"use client"

/**
 * Chat CRUD for {@link useChatWithSync}: create (or enter draft mode), rename,
 * repo reassignment, generic field updates (splitting local-only preview fields
 * from server-bound ones), and delete (with descendant cleanup + next-chat
 * selection).
 *
 * Owns the update/delete/sandbox-delete mutations since they're used nowhere
 * else; `createChatMutation` is passed in because the draft path in
 * useChatWithSync shares the same instance.
 */

import { useCallback } from "react"
import type { Chat } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { clearLocalStateForChats, collectDescendantIds } from "@/lib/storage"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { useStreamStore } from "@/lib/stores/stream-store"
import {
  removeLocalChatStateFor,
  selectFallbackNextChatId,
} from "@/lib/chat-state"
import {
  useCreateChatMutation,
  useUpdateChatMutation,
  useDeleteChatMutation,
  useArchiveChatMutation,
  useSandboxDeleteMutation,
} from "@/lib/query"

interface UseChatOperationsArgs {
  chats: Chat[]
  currentChatId: string | null
  createChatMutation: ReturnType<typeof useCreateChatMutation>
}

export interface ChatOperations {
  startNewChat: (
    repo?: string,
    baseBranch?: string,
    parentChatId?: string,
    switchTo?: boolean,
    initialStatus?: Chat["status"],
    agent?: string | null,
    model?: string | null,
  ) => Promise<string | null>
  renameChat: (chatId: string, newName: string) => Promise<void>
  updateChatRepo: (chatId: string, repo: string, baseBranch: string) => Promise<void>
  updateChatById: (chatId: string, updates: Partial<Chat>) => Promise<void>
  updateCurrentChat: (updates: Partial<Chat>) => Promise<void>
  removeChat: (
    chatId: string,
    getNextChatId?: (deletedIds: string[]) => string | null
  ) => Promise<void>
  setChatArchived: (
    chatId: string,
    archived: boolean,
    getNextChatId?: (removedIds: string[]) => string | null
  ) => Promise<void>
}

export function useChatOperations({
  chats,
  currentChatId,
  createChatMutation,
}: UseChatOperationsArgs): ChatOperations {
  const updateChatMutation = useUpdateChatMutation()
  const deleteChatMutation = useDeleteChatMutation()
  const archiveChatMutation = useArchiveChatMutation()
  const sandboxDeleteMutation = useSandboxDeleteMutation()

  const startNewChat = useCallback(async (
    repo: string = NEW_REPOSITORY,
    baseBranch: string = "main",
    parentChatId?: string,
    switchTo: boolean = true,
    initialStatus: Chat["status"] = "pending",
    agent?: string | null,
    model?: string | null,
  ): Promise<string | null> => {
    // Branch chats (with parentChatId) are created immediately since they need to reference the parent
    if (parentChatId) {
      try {
        const newChat = await createChatMutation.mutateAsync({
          repo,
          baseBranch,
          parentChatId,
          agent,
          model,
          status: initialStatus,
        })
        if (switchTo) {
          useChatSyncStore.getState().setCurrentChatId(newChat.id)
        }
        return newChat.id
      } catch (error) {
        console.error("Failed to create chat:", error)
        return null
      }
    }

    // For regular new chats, enter draft mode instead of creating in DB
    return useChatSyncStore.getState().enterDraftMode(repo, baseBranch, agent ?? null, model ?? null)
  }, [createChatMutation])

  const removeChat = useCallback(
    async (chatId: string, getNextChatId?: (deletedIds: string[]) => string | null) => {
      const allIds = collectDescendantIds(chats, chatId)
      for (const id of allIds) useStreamStore.getState().stopStream(id)
      useChatSyncStore.getState().addDeleting(allIds)

      const selectNextChat = (deletedIds: string[]) => {
        const nextChat = getNextChatId
          ? getNextChatId(deletedIds)
          : selectFallbackNextChatId(chats, deletedIds)
        useChatSyncStore.getState().setCurrentChatId(nextChat)
      }

      // Select the next chat right away (optimistically) when the open chat is
      // being deleted, so the UI moves off it immediately instead of lingering
      // until the server round-trip completes. The sidebar already removes the
      // chat optimistically via the delete mutation's onMutate.
      if (allIds.includes(currentChatId ?? "")) {
        selectNextChat(allIds)
      }

      try {
        const result = await deleteChatMutation.mutateAsync(chatId)
        for (const sandboxId of result.sandboxIdsToCleanup) {
          sandboxDeleteMutation.mutate(sandboxId)
        }
        clearLocalStateForChats(result.deletedChatIds)
        useChatSyncStore.getState().setLocalChatState((prev) => removeLocalChatStateFor(prev, result.deletedChatIds))
        // Reconcile against the server's actual deleted set in case it removed
        // descendants we didn't predict locally and the open chat was among them.
        const serverDeletedExtra = result.deletedChatIds.some((id) => !allIds.includes(id))
        if (serverDeletedExtra && result.deletedChatIds.includes(currentChatId ?? "")) {
          selectNextChat(result.deletedChatIds)
        }
      } catch (error) {
        console.error("Failed to delete chat:", error)
      } finally {
        useChatSyncStore.getState().removeDeleting(allIds)
      }
    },
    [chats, currentChatId, deleteChatMutation, sandboxDeleteMutation]
  )

  const setChatArchived = useCallback(
    async (
      chatId: string,
      archived: boolean,
      getNextChatId?: (removedIds: string[]) => string | null
    ) => {
      // Toggling archive on the *currently open* chat removes it from the
      // current view (archiving hides it from active/repo views; unarchiving
      // hides it from the Archived view). Move selection to a logical neighbor
      // first — mirroring deletion — so the main pane never lingers on a chat
      // the sidebar is now hiding. getNextChatId is the tree-ordered,
      // filter-aware resolver; the fallback deliberately skips the toggled chat
      // and any archived chat so it never lands on something hidden.
      if (chatId === currentChatId) {
        const nextChat = getNextChatId
          ? getNextChatId([chatId])
          : chats.find((c) => c.id !== chatId && !c.archived)?.id ?? null
        useChatSyncStore.getState().setCurrentChatId(nextChat)
      }
      try {
        await archiveChatMutation.mutateAsync({ chatId, archived })
      } catch (error) {
        console.error("Failed to archive chat:", error)
      }
    },
    [chats, currentChatId, archiveChatMutation]
  )

  const renameChat = useCallback(async (chatId: string, newName: string) => {
    try {
      await updateChatMutation.mutateAsync({ chatId, data: { displayName: newName } })
    } catch (error) {
      console.error("Failed to rename chat:", error)
    }
  }, [updateChatMutation])

  const updateChatRepo = useCallback(async (chatId: string, repo: string, baseBranch: string) => {
    const chat = chats.find((c) => c.id === chatId)
    if (!chat) return
    // Can select existing repo only before first message and sandbox creation
    const canSelectExistingRepo = chat.messages.length === 0 && !chat.sandboxId
    // Can assign a new repo if chat currently has NEW_REPOSITORY
    const canAssignNewRepo = chat.repo === NEW_REPOSITORY && repo !== NEW_REPOSITORY
    if (!canSelectExistingRepo && !canAssignNewRepo) return

    try {
      // When assigning a new repo to an existing sandbox, preserve the working branch.
      // Only reset branch to null when selecting a repo before sandbox creation.
      const branchToSet = canAssignNewRepo ? chat.branch : null
      await updateChatMutation.mutateAsync({ chatId, data: { repo, baseBranch, branch: branchToSet } })
    } catch (error) {
      console.error("Failed to update chat repo:", error)
    }
  }, [chats, updateChatMutation])

  // Split a Partial<Chat> into the local-only preview fields (handled by the
  // sync store) and the server-bound fields (sent through the mutation). The
  // `in`-check matters: destructuring would produce `undefined` whether the
  // key was present or absent, and an all-undefined preview update is the
  // store's "clear it" sentinel — so an unrelated update like { planModeEnabled:
  // false } would otherwise wipe the preview pane.
  const updateChatById = useCallback(async (chatId: string, updates: Partial<Chat>) => {
    const { previewItems, activePreviewIndex, previewPaneHidden, queuedMessages, queuePaused, ...serverUpdates } = updates

    if ("previewItems" in updates || "activePreviewIndex" in updates || "previewPaneHidden" in updates) {
      useChatSyncStore.getState().setPreviewStateForChat(chatId, { previewItems, activePreviewIndex, previewPaneHidden })
    }

    if (Object.keys(serverUpdates).length > 0) {
      try {
        await updateChatMutation.mutateAsync({ chatId, data: serverUpdates as Parameters<typeof updateChatMutation.mutateAsync>[0]["data"] })
      } catch (error) {
        console.error("Failed to update chat:", error)
      }
    }
  }, [updateChatMutation])

  const updateCurrentChat = useCallback(async (updates: Partial<Chat>) => {
    if (!currentChatId) return
    await updateChatById(currentChatId, updates)
  }, [currentChatId, updateChatById])

  return {
    startNewChat,
    renameChat,
    updateChatRepo,
    updateChatById,
    updateCurrentChat,
    removeChat,
    setChatArchived,
  }
}
