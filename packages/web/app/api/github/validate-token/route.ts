import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getUser, isGitHubApiError } from "@upstream/common"

/**
 * Validates whether the GitHub access token stored in the JWT is still
 * accepted by GitHub. Called once per page load by the client to detect
 * revoked / expired tokens early.
 *
 * Returns { valid: true } when the token works or when we can't
 * determine validity (network errors, GitHub 5xx). Only returns
 * { valid: false } on a definitive 401 from GitHub, so we don't
 * force re-auth during outages.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return NextResponse.json({ valid: false })
  }

  try {
    await getUser(session.accessToken)
    return NextResponse.json({ valid: true })
  } catch (error: unknown) {
    if (isGitHubApiError(error) && error.status === 401) {
      return NextResponse.json({ valid: false })
    }

    return NextResponse.json({ valid: true })
  }
}
