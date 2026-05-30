/**
 * GitHub Sync Token Endpoint (desktop app)
 *
 * Returns the authenticated user's GitHub access token so the Electron desktop
 * app can clone/fetch the user's own repos locally with isomorphic-git.
 *
 * This is the same OAuth token the server already uses for the agent's
 * auto-push and the push routes — it is the user's own token, used to mirror
 * their own repositories onto their own machine. The endpoint is session-
 * guarded; the desktop app fetches it per-sync (it is not cached client-side).
 */

import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"

export async function POST(): Promise<Response> {
  const auth = await requireGitHubAuth()
  if (isGitHubAuthError(auth)) return auth

  return Response.json({ token: auth.token })
}
