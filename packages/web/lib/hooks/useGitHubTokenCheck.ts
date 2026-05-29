"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSession } from "next-auth/react"

/**
 * Validates the GitHub access token stored in the JWT on page load.
 *
 * The JWT can outlive the GitHub token (revoked, expired, de-authorized
 * from GitHub Settings, etc.). This hook makes a single lightweight
 * check when the session first loads and exposes the result so the
 * caller can show a re-auth prompt.
 *
 * Only runs once per page load, not on every re-render.
 *
 * @returns
 *   - `githubTokenInvalid` — true when we've confirmed the stored token is
 *     rejected by GitHub (401) AND the user hasn't dismissed the warning.
 *     False by default and while the check is in flight, so the UI doesn't
 *     flash a dialog.
 *   - `dismissReAuthBanner` — call to hide the warning for the rest of the
 *     session. The state is in-memory only; a page reload re-checks.
 */
export function useGitHubTokenCheck(): {
  githubTokenInvalid: boolean
  dismissReAuthBanner: () => void
} {
  const { status } = useSession()
  const checked = useRef(false)
  const [tokenInvalid, setTokenInvalid] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (status !== "authenticated" || checked.current) return
    checked.current = true

    fetch("/api/github/validate-token")
      .then((res) => res.json())
      .then((data: { valid: boolean }) => {
        if (!data.valid) {
          setTokenInvalid(true)
        }
      })
      .catch(() => {
        // Network error reaching our own API — don't force re-auth
      })
  }, [status])

  const dismissReAuthBanner = useCallback(() => {
    setDismissed(true)
  }, [])

  return {
    githubTokenInvalid: tokenInvalid && !dismissed,
    dismissReAuthBanner,
  }
}
