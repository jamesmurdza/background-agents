import { useCallback } from "react"
import type { Branch } from "@/lib/types"
import type { TransformedRepo } from "@/lib/db-types"

interface UseRepoOperationsOptions {
  repos: TransformedRepo[]
  setRepos: React.Dispatch<React.SetStateAction<TransformedRepo[]>>
  activeRepoId: string | null
  activeRepo: TransformedRepo | null
  selectRepo: (repoId: string) => void
  setActiveBranchId: React.Dispatch<React.SetStateAction<string | null>>
  refreshQuota: () => void
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
  refreshQuota,
}: UseRepoOperationsOptions) {
  // Add a new repo
  const handleAddRepo = useCallback((repo: TransformedRepo) => {
    setRepos((prev) => [...prev, repo])
    selectRepo(repo.id)
    setActiveBranchId(null)
  }, [setRepos, selectRepo, setActiveBranchId])

  // Remove a repo and its sandboxes
  const handleRemoveRepo = useCallback((repoId: string) => {
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return

    // Clean up sandboxes for all branches
    for (const branch of repo.branches) {
      if (branch.sandboxId) {
        fetch("/api/sandbox/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId: branch.sandboxId }),
        }).catch(() => {})
      }
    }

    // Delete repo from database
    fetch(`/api/repos?id=${repoId}`, { method: "DELETE" }).catch(() => {})

    setRepos((prev) => prev.filter((r) => r.id !== repoId))
    if (activeRepoId === repoId) {
      const remaining = repos.filter((r) => r.id !== repoId)
      selectRepo(remaining[0]?.id ?? "")
      setActiveBranchId(null)
    }
  }, [repos, activeRepoId, setRepos, selectRepo, setActiveBranchId])

  // Reorder repos (drag and drop)
  const handleReorderRepos = useCallback((fromIndex: number, toIndex: number) => {
    setRepos((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [setRepos])

  // Add a new branch to the active repo
  const handleAddBranch = useCallback((branch: Branch) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return { ...r, branches: [...r.branches, branch] }
      })
    )
    setActiveBranchId(branch.id)
  }, [activeRepo, setRepos, setActiveBranchId])

  // Remove a branch from the active repo
  const handleRemoveBranch = useCallback((branchId: string, deleteRemote?: boolean, activeBranchId?: string) => {
    if (!activeRepo) return
    const branch = activeRepo.branches.find((b) => b.id === branchId)

    if (branch?.sandboxId) {
      fetch("/api/sandbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: branch.sandboxId }),
      }).catch(() => {})

      if (deleteRemote && branch) {
        fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: branch.sandboxId,
            repoPath: `/home/daytona/${activeRepo.name}`,
            action: "delete-remote-branch",
            currentBranch: branch.name,
            repoOwner: activeRepo.owner,
            repoApiName: activeRepo.name,
          }),
        }).catch(() => {})
      }
    }

    // Delete from database
    fetch(`/api/branches?id=${branchId}`, { method: "DELETE" }).catch(() => {})

    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.filter((b) => b.id !== branchId),
        }
      })
    )

    if (activeBranchId === branchId) {
      const remaining = activeRepo.branches.filter((b) => b.id !== branchId)
      setActiveBranchId(remaining[0]?.id ?? null)
    }

    // Refresh quota
    refreshQuota()
  }, [activeRepo, setRepos, setActiveBranchId, refreshQuota])

  return {
    handleAddRepo,
    handleRemoveRepo,
    handleReorderRepos,
    handleAddBranch,
    handleRemoveBranch,
  }
}

export type RepoOperations = ReturnType<typeof useRepoOperations>
