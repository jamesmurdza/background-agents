"use client"

import { useCallback, useMemo } from "react"
import { usePathname } from "next/navigation"

interface RepoFromUrl {
  owner: string
  name: string
}

/**
 * Hook for URL-based repo navigation
 * Parses repo from URL path and provides navigation functions
 * Uses history.replaceState for URL updates to avoid page reloads
 */
export function useRepoNavigation() {
  const pathname = usePathname()

  // Parse current repo from URL path
  // Matches: /repos/:owner/:repo
  const repoFromUrl = useMemo((): RepoFromUrl | null => {
    const match = pathname.match(/^\/repos\/([^/]+)\/([^/]+)/)
    if (match) {
      return {
        owner: decodeURIComponent(match[1]),
        name: decodeURIComponent(match[2]),
      }
    }
    return null
  }, [pathname])

  // Update URL to a specific repo without triggering navigation/reload
  const updateUrlToRepo = useCallback((owner: string, name: string) => {
    const encodedOwner = encodeURIComponent(owner)
    const encodedName = encodeURIComponent(name)
    const newUrl = `/repos/${encodedOwner}/${encodedName}`

    // Use replaceState to update URL without reload
    // This keeps the URL in sync but doesn't trigger React re-render
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
    updateUrlToRepo,
    updateUrlToHome,
  }
}

export type RepoNavigation = ReturnType<typeof useRepoNavigation>
