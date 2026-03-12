import { useCallback, useRef } from "react"
import type { Branch, Message } from "@/lib/types"
import type { TransformedRepo } from "@/lib/db-types"
import { BRANCH_STATUS } from "@/lib/constants"

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

    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            // If updates include a new id, use it to replace the branch id
            const newBranch = { ...b, ...updates }
            if (updates.id) {
              newBranch.id = updates.id
            }
            return newBranch
          }),
        }
      })
    )

    // Also update activeBranchId if it's being replaced
    if (updates.id && activeBranchIdRef.current === branchId) {
      setActiveBranchId(updates.id)
    }

    // Only update in database if branch exists there (not during creation)
    // When id is provided, we're transitioning from client-side to server-side ID
    const shouldPersist = !isBeingCreated || updates.id
    if (shouldPersist && (updates.status || updates.prUrl || updates.name || updates.draftPrompt !== undefined || updates.agent || updates.model !== undefined)) {
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

    // Update local state
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return { ...b, draftPrompt }
          }),
        }
      })
    )

    // Persist to database
    fetch("/api/branches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, draftPrompt }),
    }).catch(() => {})
  }, [activeRepo, setRepos])

  // Add a message to a branch
  const handleAddMessage = useCallback(async (branchId: string, message: Message): Promise<string> => {
    if (!activeRepo) return message.id

    // Add message to local state immediately with temporary ID
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return {
              ...b,
              messages: [...b.messages, message],
            }
          }),
        }
      })
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
        setRepos((prev) =>
          prev.map((r) => {
            if (r.id !== activeRepo.id) return r
            return {
              ...r,
              branches: r.branches.map((b) => {
                if (b.id !== branchId) return b
                return {
                  ...b,
                  messages: b.messages.map((m) =>
                    m.id === message.id ? { ...m, id: dbId } : m
                  ),
                }
              }),
            }
          })
        )
        return dbId
      }
      return message.id
    } catch (error) {
      console.error("Error saving message to database:", error)
      // Re-throw so caller knows message wasn't saved - prevents foreign key errors
      throw error
    }
  }, [activeRepo, setRepos])

  // Update an existing message
  const handleUpdateMessage = useCallback((branchId: string, messageId: string, updates: Partial<Message>) => {
    if (!activeRepo) return

    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return {
              ...b,
              messages: b.messages.map((m) =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
            }
          }),
        }
      })
    )

    // Update message in database
    fetch("/api/branches/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        content: updates.content,
        toolCalls: updates.toolCalls,
        contentBlocks: updates.contentBlocks,
      }),
    }).catch((error) => {
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
