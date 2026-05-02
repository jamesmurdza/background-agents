"use client"

import { useState, useEffect, useRef } from "react"
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
 * @returns `githubTokenInvalid` — true when we've confirmed the stored
 *          token is rejected by GitHub (401). False by default and while
 *          the check is in flight, so the UI doesn't flash a dialog.
 */
export function useGitHubTokenCheck(): { githubTokenInvalid: boolean } {
  const { status } = useSession()
  const checked = useRef(false)
  const [githubTokenInvalid, setGithubTokenInvalid] = useState(false)

  useEffect(() => {
    if (status !== "authenticated" || checked.current) return
    checked.current = true

    fetch("/api/github/validate-token")
      .then((res) => res.json())
      .then((data: { valid: boolean }) => {
        if (!data.valid) {
          setGithubTokenInvalid(true)
        }
      })
      .catch(() => {
        // Network error reaching our own API — don't force re-auth
      })
  }, [status])

  return { githubTokenInvalid }
}
