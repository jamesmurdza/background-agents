import { useCallback } from "react"
import type { Branch, Message } from "@/lib/types"
import type { TransformedRepo } from "@/lib/db-types"
import { BRANCH_STATUS } from "@/lib/constants"
import {
  updateBranchInRepo,
  updateMessageInBranch,
  addMessageToBranch,
} from "@/lib/state-utils"

interface UseBranchOperationsOptions {
  repos: TransformedRepo[]
  setRepos: React.Dispatch<React.SetStateAction<TransformedRepo[]>>
  activeRepo: TransformedRepo | null
  activeBranchIdRef: React.MutableRefObject<string | null>
  setActiveBranchId: React.Dispatch<React.SetStateAction<string | null>>
}

/**
 * Provides update operations for branches and messages
 */
export function useBranchOperations({
  repos,
  setRepos,
  activeRepo,
  activeBranchIdRef,
  setActiveBranchId,
}: UseBranchOperationsOptions) {
  // Update branch properties
  const handleUpdateBranch = useCallback((branchId: string, updates: Partial<Branch>) => {
    if (!activeRepo) return

    // Find the branch to check its current status
    const branch = activeRepo.branches.find((b) => b.id === branchId)
    const isBeingCreated = branch?.status === BRANCH_STATUS.CREATING

    // The actual ID to use for database operations (might be a new server-side ID)
    const dbBranchId = updates.id || branchId

    setRepos((prev) => updateBranchInRepo(prev, activeRepo.id, branchId, updates))

    // Also update activeBranchId if it's being replaced
    if (updates.id && activeBranchIdRef.current === branchId) {
      setActiveBranchId(updates.id)
    }

    // Only update in database if branch exists there (not during creation)
    // When id is provided, we're transitioning from client-side to server-side ID
    const shouldPersist = !isBeingCreated || updates.id
    if (shouldPersist && (updates.status || updates.prUrl || updates.name || updates.draftPrompt !== undefined)) {
      fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: dbBranchId, ...updates }),
      }).catch(() => {})
    }
  }, [activeRepo, setRepos, activeBranchIdRef, setActiveBranchId])

  // Save draft prompt for a specific branch
  const handleSaveDraftForBranch = useCallback((branchId: string, draftPrompt: string) => {
    if (!activeRepo) return

    setRepos((prev) => updateBranchInRepo(prev, activeRepo.id, branchId, { draftPrompt }))

    // Persist to database
    fetch("/api/branches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, draftPrompt }),
    }).catch(() => {})
  }, [activeRepo, setRepos])

  // Add a message to a branch
  const handleAddMessage = useCallback(async (branchId: string, message: Message): Promise<string> => {
    // Find which repo actually contains this branch (may not be activeRepo for background polling)
    const targetRepo = repos.find(r => r.branches.some(b => b.id === branchId))
    if (!targetRepo) return message.id

    const now = Date.now()
    // Add message and bump branch to top of list (lastActivityTs drives sort order)
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
      const res = await fetch("/api/branches/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls,
          contentBlocks: message.contentBlocks,
          timestamp: message.timestamp,
          commitHash: message.commitHash,
          commitMessage: message.commitMessage,
        }),
      })

      if (!res.ok) {
        const errorText = await res.text().catch(() => res.statusText)
        throw new Error(`Failed to save message: ${errorText}`)
      }

      const data = await res.json()
      const dbId = data.message?.id

      if (dbId && dbId !== message.id) {
        // Update local state with the real database ID
        setRepos((prev) => updateMessageInBranch(prev, targetRepo.id, branchId, message.id, { id: dbId }))
        return dbId
      }
      return message.id
    } catch (error) {
      console.error("Error saving message to database:", error)
      // Re-throw so caller knows message wasn't saved - prevents foreign key errors
      throw error
    }
  }, [repos, setRepos])

  // Update an existing message. Returns a promise that resolves when the DB PATCH completes (for awaiting final save on completion).
  const handleUpdateMessage = useCallback((branchId: string, messageId: string, updates: Partial<Message>): void | Promise<void> => {
    if (!activeRepo) return

    setRepos((prev) => updateMessageInBranch(prev, activeRepo.id, branchId, messageId, updates))

    return fetch("/api/branches/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        content: updates.content,
        toolCalls: updates.toolCalls,
        contentBlocks: updates.contentBlocks,
      }),
    })
      .then(() => {})
      .catch((error) => {
        console.error("Error updating message in database:", error)
      })
  }, [activeRepo, setRepos])

  return {
    handleUpdateBranch,
    handleSaveDraftForBranch,
    handleAddMessage,
    handleUpdateMessage,
  }
}

export type BranchOperations = ReturnType<typeof useBranchOperations>
