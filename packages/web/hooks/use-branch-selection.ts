"use client"

import { useEffect, useRef, useMemo, useCallback } from "react"
import type { Repo } from "@/lib/shared/types"
import { useSelectionStore } from "@/lib/stores"

interface RepoFromUrl {
  owner: string
  name: string
}

interface UseBranchSelectionOptions {
  repos: Repo[]
  loaded: boolean
  repoFromUrl?: RepoFromUrl | null
  branchFromUrl?: string | null
  /** Called when branch from URL is not found - should update URL to remove branch */
  onBranchNotFound?: () => void
}

/**
 * Manages active repo/branch selection state with auto-selection on load
 * Supports URL-based repo and branch selection
 * Now uses Zustand for state management.
 */
export function useBranchSelection({ repos, loaded, repoFromUrl, branchFromUrl, onBranchNotFound }: UseBranchSelectionOptions) {
  const {
    activeRepoId,
    activeBranchId,
    initialSelectionDone,
    setActiveRepoId,
    setActiveBranchId,
    selectRepo: storeSelectRepo,
    selectBranch: storeSelectBranch,
    updateActiveBranchId,
    markInitialSelectionDone,
  } = useSelectionStore()

  // Keep a ref for accessing current value in callbacks without dependency
  const activeBranchIdRef = useRef(activeBranchId)
  activeBranchIdRef.current = activeBranchId

  // Track if we've handled the branch from URL to avoid repeated callbacks
  const handledBranchFromUrlRef = useRef<string | null>(null)

  // Handle URL-based repo/branch selection on initial load
  useEffect(() => {
    if (!loaded || repos.length === 0) return

    // If URL specifies a repo, try to select it
    if (repoFromUrl && !initialSelectionDone) {
      const matchingRepo = repos.find(
        (r) =>
          r.owner.toLowerCase() === repoFromUrl.owner.toLowerCase() &&
          r.name.toLowerCase() === repoFromUrl.name.toLowerCase()
      )

      if (matchingRepo) {
        // If URL also specifies a branch, try to find it
        let branchToSelect = matchingRepo.branches[0]?.id ?? null
        if (branchFromUrl) {
          const matchingBranch = matchingRepo.branches.find(
            (b) => b.name.toLowerCase() === branchFromUrl.toLowerCase()
          )
          if (matchingBranch) {
            branchToSelect = matchingBranch.id
            handledBranchFromUrlRef.current = branchFromUrl
          } else {
            // Branch not found - will call onBranchNotFound after selection
            handledBranchFromUrlRef.current = null
          }
        }
        storeSelectRepo(matchingRepo.id, branchToSelect)
        markInitialSelectionDone()

        // If branch was specified but not found, notify caller
        if (branchFromUrl && !handledBranchFromUrlRef.current) {
          onBranchNotFound?.()
        }
        return
      }
      // If URL repo not found, we'll fall through to default selection
    }

    // Auto-select first repo/branch on load if nothing selected
    const currentRepo = activeRepoId ? repos.find((r) => r.id === activeRepoId) : null
    const currentBranch =
      currentRepo && activeBranchId
        ? currentRepo.branches.find((b) => b.id === activeBranchId)
        : null

    if (currentRepo && currentBranch) {
      markInitialSelectionDone()
      return
    }

    // Valid repo selected but no branch (e.g. just added repo) — only fix branch, don't change repo
    if (currentRepo) {
      setActiveBranchId(currentRepo.branches[0]?.id ?? null)
      markInitialSelectionDone()
      return
    }

    // No valid selection, select first repo
    storeSelectRepo(repos[0].id, repos[0].branches[0]?.id ?? null)
    markInitialSelectionDone()
  }, [loaded, repos, activeRepoId, activeBranchId, repoFromUrl, branchFromUrl, initialSelectionDone, storeSelectRepo, setActiveBranchId, markInitialSelectionDone, onBranchNotFound])

  // Sync selection when URL changes (for browser back/forward)
  useEffect(() => {
    if (!loaded || repos.length === 0 || !initialSelectionDone) return
    if (!repoFromUrl) return // URL is at root, don't change selection

    const matchingRepo = repos.find(
      (r) =>
        r.owner.toLowerCase() === repoFromUrl.owner.toLowerCase() &&
        r.name.toLowerCase() === repoFromUrl.name.toLowerCase()
    )

    if (matchingRepo && matchingRepo.id !== activeRepoId) {
      // If URL also specifies a branch, try to find it
      let branchToSelect = matchingRepo.branches[0]?.id ?? null
      if (branchFromUrl) {
        const matchingBranch = matchingRepo.branches.find(
          (b) => b.name.toLowerCase() === branchFromUrl.toLowerCase()
        )
        if (matchingBranch) {
          branchToSelect = matchingBranch.id
        } else {
          // Branch not found, notify caller
          onBranchNotFound?.()
        }
      }
      storeSelectRepo(matchingRepo.id, branchToSelect)
    } else if (matchingRepo && branchFromUrl && handledBranchFromUrlRef.current !== branchFromUrl) {
      // Same repo but different branch in URL - try to select the branch
      const matchingBranch = matchingRepo.branches.find(
        (b) => b.name.toLowerCase() === branchFromUrl.toLowerCase()
      )
      if (matchingBranch && matchingBranch.id !== activeBranchId) {
        storeSelectBranch(matchingBranch.id)
        handledBranchFromUrlRef.current = branchFromUrl
      } else if (!matchingBranch) {
        // Branch not found
        onBranchNotFound?.()
      }
    }
  }, [repoFromUrl, branchFromUrl, repos, loaded, activeRepoId, activeBranchId, initialSelectionDone, storeSelectRepo, storeSelectBranch, onBranchNotFound])

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

  // Selection handlers that also find the first branch
  const selectRepo = useCallback((repoId: string) => {
    const repo = repos.find((r) => r.id === repoId)
    storeSelectRepo(repoId, repo?.branches[0]?.id ?? null)
  }, [repos, storeSelectRepo])

  const selectBranch = useCallback((branchId: string) => {
    storeSelectBranch(branchId)
  }, [storeSelectBranch])

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
