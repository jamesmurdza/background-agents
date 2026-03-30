import { useCallback } from "react"
import type { Branch } from "@/lib/shared/types"
import type { TransformedRepo } from "@/lib/db/db-types"
import { transformRepo } from "@/lib/db/db-types"
import {
  removeRepo,
  reorderRepos,
  addBranchToRepo,
  removeBranchFromRepo,
} from "@/lib/shared/state-utils"
import { PATHS } from "@/lib/shared/constants"

interface UseRepoOperationsOptions {
  repos: TransformedRepo[]
  setRepos: React.Dispatch<React.SetStateAction<TransformedRepo[]>>
  activeRepoId: string | null
  activeRepo: TransformedRepo | null
  selectRepo: (repoId: string) => void
  setActiveBranchId: (branchId: string | null) => void
  refresh: () => void
}

/**
 * Provides CRUD operations for repos and basic branch operations
 */
export function useRepoOperations({
  repos,
  setRepos,
  activeRepoId,
  activeRepo,
  selectRepo,
  setActiveBranchId,
  refresh,
}: UseRepoOperationsOptions) {
  // Add a new repo (persists to DB, then updates state and selection)
  const handleAddRepo = useCallback(
    async (repo: TransformedRepo) => {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: repo.name,
          owner: repo.owner,
          avatar: repo.avatar || null,
          defaultBranch: repo.defaultBranch,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to add repository")
      const transformed = transformRepo(data.repo)
      setRepos((prev) => {
        const newRepos = [...prev, transformed]
        // Persist the new order to database (fire and forget)
        fetch("/api/user/repo-order", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoOrder: newRepos.map((r) => r.id) }),
        }).catch(() => {})
        return newRepos
      })
      selectRepo(transformed.id)
      setActiveBranchId(null)
    },
    [setRepos, selectRepo, setActiveBranchId]
  )

  // Remove a repo and its sandboxes
  const handleRemoveRepo = useCallback(async (repoId: string) => {
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return

    // Update UI state immediately for responsiveness
    setRepos((prev) => {
      const newRepos = removeRepo(prev, repoId)
      // Persist the new order to database (fire and forget - non-critical)
      fetch("/api/user/repo-order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoOrder: newRepos.map((r) => r.id) }),
      }).catch(() => {})
      return newRepos
    })

    if (activeRepoId === repoId) {
      const remaining = repos.filter((r) => r.id !== repoId)
      selectRepo(remaining[0]?.id ?? "")
      setActiveBranchId(null)
    }

    // Server handles Daytona sandbox cleanup
    try {
      const res = await fetch(`/api/repos?id=${repoId}`, { method: "DELETE" })
      if (!res.ok) {
        console.error(`[handleRemoveRepo] Failed to delete repo ${repoId}: ${res.status}`)
      }
    } catch (error) {
      console.error(`[handleRemoveRepo] Error deleting repo ${repoId}:`, error)
    }
  }, [repos, activeRepoId, setRepos, selectRepo, setActiveBranchId])

  // Reorder repos (drag and drop) - persists order to database
  const handleReorderRepos = useCallback((fromIndex: number, toIndex: number) => {
    setRepos((prev) => {
      const reordered = reorderRepos(prev, fromIndex, toIndex)
      // Persist the new order to database (fire and forget)
      fetch("/api/user/repo-order", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoOrder: reordered.map((r) => r.id) }),
      }).catch(() => {})
      return reordered
    })
  }, [setRepos])

  // Add a new branch to the active repo
  const handleAddBranch = useCallback((branch: Branch) => {
    if (!activeRepo) return
    setRepos((prev) => addBranchToRepo(prev, activeRepo.id, branch))
    setActiveBranchId(branch.id)
  }, [activeRepo, setRepos, setActiveBranchId])

  // Remove a branch from the active repo
  const handleRemoveBranch = useCallback(async (branchId: string, deleteRemote?: boolean, activeBranchId?: string) => {
    if (!activeRepo) return
    const branch = activeRepo.branches.find((b) => b.id === branchId)
    const remainingAfterDeletion = activeRepo.branches.filter((b) => b.id !== branchId)

    // Delete remote branch if requested (must happen before sandbox is deleted)
    if (deleteRemote && branch?.sandboxId) {
      try {
        await fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: branch.sandboxId,
            repoPath: `${PATHS.SANDBOX_HOME}/${activeRepo.name}`,
            action: "delete-remote-branch",
            currentBranch: branch.name,
            repoOwner: activeRepo.owner,
            repoApiName: activeRepo.name,
          }),
        })
      } catch (error) {
        console.error(`[handleRemoveBranch] Error deleting remote branch:`, error)
        // Continue with branch deletion even if remote delete fails
      }
    }

    // Server handles Daytona sandbox cleanup
    try {
      const res = await fetch(`/api/branches?id=${branchId}`, { method: "DELETE" })
      if (!res.ok) {
        // 404 means branch was already deleted (e.g., from another tab or concurrent deletion)
        // This is not an error condition since the desired state is achieved
        if (res.status !== 404) {
          console.error(`[handleRemoveBranch] Failed to delete branch ${branchId}: ${res.status}`)
        }
      }
    } catch (error) {
      console.error(`[handleRemoveBranch] Error deleting branch ${branchId}:`, error)
    }

    // Update UI after server deletion completes so row-level spinners can be shown immediately.
    setRepos((prev) => removeBranchFromRepo(prev, activeRepo.id, branchId))

    if (activeBranchId === branchId) {
      setActiveBranchId(remainingAfterDeletion[0]?.id ?? null)
    }

    // Refresh data
    refresh()
  }, [activeRepo, setRepos, setActiveBranchId, refresh])

  return {
    handleAddRepo,
    handleRemoveRepo,
    handleReorderRepos,
    handleAddBranch,
    handleRemoveBranch,
  }
}

export type RepoOperations = ReturnType<typeof useRepoOperations>
