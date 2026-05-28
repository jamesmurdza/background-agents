import { NextResponse } from "next/server"
import { getUser, isGitHubApiError } from "@background-agents/common"
import { requireGitHubAuth, isGitHubAuthError } from "@/lib/db/api-helpers"

/**
 * Validates whether the GitHub access token stored in the database is still
 * accepted by GitHub. Called once per page load by the client to detect
 * revoked / expired tokens early.
 *
 * Returns { valid: true } when the token works or when we can't
 * determine validity (network errors, GitHub 5xx). Only returns
 * { valid: false } on a definitive 401 from GitHub, so we don't
 * force re-auth during outages.
 */
export async function GET() {
  const ghAuth = await requireGitHubAuth()
  if (isGitHubAuthError(ghAuth)) {
    return NextResponse.json({ valid: false })
  }

  try {
    await getUser(ghAuth.token)
    return NextResponse.json({ valid: true })
  } catch (error: unknown) {
    if (isGitHubApiError(error) && error.status === 401) {
      return NextResponse.json({ valid: false })
    }

    return NextResponse.json({ valid: true })
  }
}
