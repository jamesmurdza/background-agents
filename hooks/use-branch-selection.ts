import { useState, useEffect, useRef, useMemo } from "react"
import type { Branch, Repo } from "@/lib/types"

interface UseBranchSelectionOptions {
  repos: Repo[]
  loaded: boolean
}

/**
 * Manages active repo/branch selection state with auto-selection on load
 */
export function useBranchSelection({ repos, loaded }: UseBranchSelectionOptions) {
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)

  // Keep a ref for accessing current value in callbacks without dependency
  const activeBranchIdRef = useRef(activeBranchId)
  activeBranchIdRef.current = activeBranchId

  // Auto-select first repo/branch on load; never overwrite existing valid selection when list reorders
  useEffect(() => {
    if (!loaded || repos.length === 0) return
    const currentRepo = activeRepoId ? repos.find((r) => r.id === activeRepoId) : null
    const currentBranch =
      currentRepo && activeBranchId
        ? currentRepo.branches.find((b) => b.id === activeBranchId)
        : null
    if (currentRepo && currentBranch) return

    setActiveRepoId(repos[0].id)
    if (repos[0].branches.length > 0) {
      setActiveBranchId(repos[0].branches[0].id)
    } else {
      setActiveBranchId(null)
    }
  }, [loaded, repos, activeRepoId, activeBranchId])

  // Computed values
  const activeRepo = useMemo(
    () => repos.find((r) => r.id === activeRepoId) ?? null,
    [repos, activeRepoId]
  )

  const activeBranch = useMemo(
    () => (activeBranchId && activeRepo
      ? activeRepo.branches.find((b) => b.id === activeBranchId) ?? null
      : null),
    [activeBranchId, activeRepo]
  )

  // Selection handlers
  function selectRepo(repoId: string) {
    setActiveRepoId(repoId)
    const repo = repos.find((r) => r.id === repoId)
    setActiveBranchId(repo?.branches[0]?.id ?? null)
  }

  function selectBranch(branchId: string) {
    setActiveBranchId(branchId)
  }

  // Update activeBranchId when the branch ID changes (e.g., during branch creation)
  function updateActiveBranchId(oldId: string, newId: string) {
    if (activeBranchIdRef.current === oldId) {
      setActiveBranchId(newId)
    }
  }

  return {
    // State
    activeRepoId,
    activeBranchId,
    activeBranchIdRef,

    // Computed
    activeRepo,
    activeBranch,

    // Setters
    setActiveRepoId,
    setActiveBranchId,

    // Actions
    selectRepo,
    selectBranch,
    updateActiveBranchId,
  }
}

export type BranchSelection = ReturnType<typeof useBranchSelection>
