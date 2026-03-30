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
}

/**
 * Manages active repo/branch selection state with auto-selection on load
 * Supports URL-based repo selection via repoFromUrl parameter
 * Now uses Zustand for state management.
 */
export function useBranchSelection({ repos, loaded, repoFromUrl }: UseBranchSelectionOptions) {
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

  // Keep refs for accessing current values in callbacks without dependency
  const activeBranchIdRef = useRef(activeBranchId)
  activeBranchIdRef.current = activeBranchId

  const reposRef = useRef(repos)
  reposRef.current = repos

  // Handle URL-based repo selection on initial load
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
        storeSelectRepo(matchingRepo.id, matchingRepo.branches[0]?.id ?? null)
        markInitialSelectionDone()
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
  }, [loaded, repos, activeRepoId, activeBranchId, repoFromUrl, initialSelectionDone, storeSelectRepo, setActiveBranchId, markInitialSelectionDone])

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
      storeSelectRepo(matchingRepo.id, matchingRepo.branches[0]?.id ?? null)
    }
  }, [repoFromUrl, repos, loaded, activeRepoId, initialSelectionDone, storeSelectRepo])

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
    const repo = reposRef.current.find((r) => r.id === repoId)
    storeSelectRepo(repoId, repo?.branches[0]?.id ?? null)
  }, [storeSelectRepo])

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
