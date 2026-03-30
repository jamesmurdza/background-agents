"use client"

import { useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Branch, Message } from "@/lib/shared/types"
import type { TransformedRepo } from "@/lib/db/db-types"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import {
  updateBranchInRepo,
  updateMessageInBranch,
  addMessageToBranch,
} from "@/lib/shared/state-utils"
import { queryKeys } from "@/lib/api/query-keys"
import { apiPatch, apiPost } from "@/lib/api/fetcher"

interface UseBranchOperationsOptions {
  repos: TransformedRepo[]
  setRepos: React.Dispatch<React.SetStateAction<TransformedRepo[]>>
  activeRepo: TransformedRepo | null
  activeBranchIdRef: React.MutableRefObject<string | null>
  setActiveBranchId: (branchId: string | null) => void
}

/**
 * Provides update operations for branches and messages using TanStack Query mutations
 */
export function useBranchOperations({
  repos,
  setRepos,
  activeRepo,
  activeBranchIdRef,
  setActiveBranchId,
}: UseBranchOperationsOptions) {
  const queryClient = useQueryClient()

  // Mutation for updating branch
  const updateBranchMutation = useMutation({
    mutationFn: async ({ branchId, updates }: { branchId: string; updates: Partial<Branch> }) => {
      return apiPatch<{ success: boolean }>("/api/branches", {
        branchId,
        ...updates,
      })
    },
    onError: (error) => {
      console.error("Failed to update branch:", error)
    },
  })

  // Mutation for saving draft
  const saveDraftMutation = useMutation({
    mutationFn: async ({ branchId, draftPrompt }: { branchId: string; draftPrompt: string }) => {
      return apiPatch<{ success: boolean }>("/api/branches", {
        branchId,
        draftPrompt,
      })
    },
    onError: (error) => {
      console.error("Failed to save draft:", error)
    },
  })

  // Mutation for adding message
  const addMessageMutation = useMutation({
    mutationFn: async ({ branchId, message }: { branchId: string; message: Message }) => {
      return apiPost<{ message: { id: string } }>("/api/branches/messages", {
        branchId,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
        contentBlocks: message.contentBlocks,
        timestamp: message.timestamp,
        commitHash: message.commitHash,
        commitMessage: message.commitMessage,
        ...(message.role === "assistant" && {
          assistantSource:
            message.assistantSource ?? (message.commitHash ? "commit" : "model"),
        }),
        ...(message.pushError != null && { pushError: message.pushError }),
      })
    },
    onError: (error) => {
      console.error("Failed to add message:", error)
    },
  })

  // Mutation for updating message
  const updateMessageMutation = useMutation({
    mutationFn: async ({ messageId, updates }: { messageId: string; updates: Partial<Message> }) => {
      return apiPatch<{ success: boolean }>("/api/branches/messages", {
        messageId,
        ...(updates.content !== undefined && { content: updates.content }),
        ...(updates.toolCalls !== undefined && { toolCalls: updates.toolCalls }),
        ...(updates.contentBlocks !== undefined && { contentBlocks: updates.contentBlocks }),
        ...("pushError" in updates && { pushError: updates.pushError ?? null }),
      })
    },
    onError: (error) => {
      console.error("Failed to update message:", error)
    },
  })

  // Update branch properties
  const handleUpdateBranch = useCallback((branchId: string, updates: Partial<Branch>) => {
    // Use functional update to always access the latest state
    let isBeingCreated = false
    let foundRepo = false

    setRepos((prev) => {
      // Find the repo containing this branch from the latest state
      const targetRepo = prev.find(r => r.branches.some(b => b.id === branchId))
      if (!targetRepo) return prev

      foundRepo = true
      const branch = targetRepo.branches.find((b) => b.id === branchId)
      isBeingCreated = branch?.status === BRANCH_STATUS.CREATING

      return updateBranchInRepo(prev, targetRepo.id, branchId, updates)
    })

    // Early return if branch wasn't found
    if (!foundRepo) return

    // The actual ID to use for database operations
    const dbBranchId = updates.id || branchId

    // Also update activeBranchId if it's being replaced
    if (updates.id && activeBranchIdRef.current === branchId) {
      setActiveBranchId(updates.id)
    }

    // Only update in database if branch exists there (not during creation)
    const shouldPersist = !isBeingCreated || updates.id
    const hasFieldsToPersist = updates.status || updates.prUrl || updates.name || updates.draftPrompt !== undefined ||
      updates.loopEnabled !== undefined || updates.loopCount !== undefined || updates.loopMaxIterations !== undefined ||
      updates.agent !== undefined || updates.model !== undefined

    if (shouldPersist && hasFieldsToPersist) {
      updateBranchMutation.mutate({ branchId: dbBranchId, updates })
    }
  }, [setRepos, activeBranchIdRef, setActiveBranchId, updateBranchMutation])

  // Save draft prompt for a specific branch
  const handleSaveDraftForBranch = useCallback((branchId: string, draftPrompt: string) => {
    if (!activeRepo) return

    setRepos((prev) => updateBranchInRepo(prev, activeRepo.id, branchId, { draftPrompt }))

    // Persist to database
    saveDraftMutation.mutate({ branchId, draftPrompt })
  }, [activeRepo, setRepos, saveDraftMutation])

  // Add a message to a branch
  const handleAddMessage = useCallback(async (branchId: string, message: Message): Promise<string> => {
    // Find which repo actually contains this branch
    const targetRepo = repos.find(r => r.branches.some(b => b.id === branchId))
    if (!targetRepo) return message.id

    const now = Date.now()
    // Add message and bump branch to top of list
    setRepos((prev) =>
      updateBranchInRepo(
        addMessageToBranch(prev, targetRepo.id, branchId, message),
        targetRepo.id,
        branchId,
        { lastActivity: "now", lastActivityTs: now }
      )
    )

    // Save message to database and get the real DB ID
    try {
      const data = await addMessageMutation.mutateAsync({ branchId, message })
      const dbId = data.message?.id

      if (dbId && dbId !== message.id) {
        // Update local state with the real database ID
        setRepos((prev) => updateMessageInBranch(prev, targetRepo.id, branchId, message.id, { id: dbId }))
        return dbId
      }
      return message.id
    } catch (error) {
      console.error("Error saving message to database:", error)
      throw error
    }
  }, [repos, setRepos, addMessageMutation])

  // Update an existing message
  const handleUpdateMessage = useCallback((branchId: string, messageId: string, updates: Partial<Message>): void | Promise<void> => {
    if (!activeRepo) return

    setRepos((prev) => updateMessageInBranch(prev, activeRepo.id, branchId, messageId, updates))

    return updateMessageMutation.mutateAsync({ messageId, updates }).then(() => {})
  }, [activeRepo, setRepos, updateMessageMutation])

  return {
    handleUpdateBranch,
    handleSaveDraftForBranch,
    handleAddMessage,
    handleUpdateMessage,
  }
}

export type BranchOperations = ReturnType<typeof useBranchOperations>
