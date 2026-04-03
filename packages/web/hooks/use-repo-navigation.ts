"use client"

import { useCallback, useMemo } from "react"
import { usePathname } from "next/navigation"

interface RepoFromUrl {
  owner: string
  name: string
}

interface UrlState {
  owner: string
  name: string
  branch: string | null
}

// Reserved paths that should NOT be treated as owner/repo patterns
const RESERVED_PATHS = new Set([
  "api",
  "login",
  "admin",
  "team",
  "mcp-callback",
  "repo", // Keep supporting old /repo/ URLs for backwards compatibility
  "_next",
])

/**
 * Encode a branch name for use in URL path
 * Branch names can contain slashes, so we encode each segment
 */
function encodeBranchForUrl(branch: string): string {
  return branch.split("/").map(encodeURIComponent).join("/")
}

/**
 * Hook for URL-based repo navigation
 * Parses repo from URL path and provides navigation functions
 * Uses history.replaceState for URL updates to avoid page reloads
 *
 * URL pattern: /:owner/:repo/:branch? (e.g., /facebook/react/feature/new-hooks)
 * Branch names can contain slashes (e.g., feature/foo/bar)
 * Reserved paths like /api, /login, /admin, etc. are excluded
 */
export function useRepoNavigation() {
  const pathname = usePathname()

  // Parse current URL state (owner, repo, and optional branch)
  // Branch names can contain slashes, so we capture everything after /:owner/:repo/
  const urlState = useMemo((): UrlState | null => {
    // First check for legacy /repo/ format (without branch support)
    const legacyMatch = pathname.match(/^\/repo\/([^/]+)\/([^/]+)/)
    if (legacyMatch) {
      return {
        owner: decodeURIComponent(legacyMatch[1]),
        name: decodeURIComponent(legacyMatch[2]),
        branch: null,
      }
    }

    // Check for new format: /:owner/:repo/:branch?
    // Match owner and repo first (non-slash segments), then capture rest as branch
    const match = pathname.match(/^\/([^/]+)\/([^/]+)(?:\/(.+))?$/)
    if (match) {
      const owner = decodeURIComponent(match[1])
      // Skip if it's a reserved path
      if (RESERVED_PATHS.has(owner.toLowerCase())) {
        return null
      }
      // Decode each segment of the branch path
      const branchPath = match[3]
      const branch = branchPath
        ? branchPath.split("/").map(decodeURIComponent).join("/")
        : null
      return {
        owner,
        name: decodeURIComponent(match[2]),
        branch,
      }
    }
    return null
  }, [pathname])

  // For backwards compatibility, extract just repo info
  const repoFromUrl = useMemo((): RepoFromUrl | null => {
    if (!urlState) return null
    return { owner: urlState.owner, name: urlState.name }
  }, [urlState])

  // Get branch from URL
  const branchFromUrl = useMemo((): string | null => {
    return urlState?.branch ?? null
  }, [urlState])

  // Update URL to a specific repo (without branch)
  const updateUrlToRepo = useCallback((owner: string, name: string) => {
    const encodedOwner = encodeURIComponent(owner)
    const encodedName = encodeURIComponent(name)
    const newUrl = `/${encodedOwner}/${encodedName}`

    // Use replaceState to update URL without reload
    if (typeof window !== "undefined" && window.location.pathname !== newUrl) {
      window.history.replaceState(null, "", newUrl)
    }
  }, [])

  // Update URL to a specific repo and branch
  const updateUrlToRepoBranch = useCallback((owner: string, name: string, branch: string) => {
    const encodedOwner = encodeURIComponent(owner)
    const encodedName = encodeURIComponent(name)
    const encodedBranch = encodeBranchForUrl(branch)
    const newUrl = `/${encodedOwner}/${encodedName}/${encodedBranch}`

    // Use replaceState to update URL without reload
    if (typeof window !== "undefined" && window.location.pathname !== newUrl) {
      window.history.replaceState(null, "", newUrl)
    }
  }, [])

  // Update URL to home without triggering navigation
  const updateUrlToHome = useCallback(() => {
    if (typeof window !== "undefined" && window.location.pathname !== "/") {
      window.history.replaceState(null, "", "/")
    }
  }, [])

  return {
    repoFromUrl,
    branchFromUrl,
    updateUrlToRepo,
    updateUrlToRepoBranch,
    updateUrlToHome,
  }
}

export type RepoNavigation = ReturnType<typeof useRepoNavigation>
