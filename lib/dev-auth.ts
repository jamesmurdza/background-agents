/**
 * Development authentication bypass
 *
 * When GITHUB_PAT is set, this module provides a mock user for local development
 * and uses the PAT for all GitHub operations. The dev user is auto-created in
 * the database on first use.
 *
 * WARNING: Never set GITHUB_PAT in production!
 */

import { prisma } from "@/lib/prisma"

// Fixed dev user ID - consistent across restarts
export const DEV_USER_ID = "dev-user-00000000-0000-0000-0000-000000000000"

export const DEV_USER = {
  id: DEV_USER_ID,
  email: "dev@localhost",
  name: "Dev User",
  githubId: "000000",
  githubLogin: "dev-user",
}

/**
 * Check if auth should be skipped (development only)
 * Triggered by presence of GITHUB_PAT environment variable
 */
export function isAuthSkipped(): boolean {
  // Never skip auth in production
  if (process.env.NODE_ENV === "production") {
    return false
  }
  return !!process.env.GITHUB_PAT
}

/**
 * Get the GitHub PAT from environment (for dev mode)
 */
export function getDevGitHubToken(): string | null {
  if (!isAuthSkipped()) return null
  return process.env.GITHUB_PAT || null
}

/**
 * Ensures the dev user exists in the database.
 * Creates the user and related records if they don't exist.
 * This is called lazily on first auth check when GITHUB_PAT is set.
 */
export async function ensureDevUserExists(): Promise<void> {
  const existingUser = await prisma.user.findUnique({
    where: { id: DEV_USER_ID },
  })

  if (existingUser) {
    return
  }

  console.warn("\n" + "=".repeat(60))
  console.warn("GITHUB_PAT: Creating dev user in database...")
  console.warn("=".repeat(60) + "\n")

  // Create the dev user
  await prisma.user.create({
    data: {
      id: DEV_USER_ID,
      email: DEV_USER.email,
      name: DEV_USER.name,
      githubId: DEV_USER.githubId,
      githubLogin: DEV_USER.githubLogin,
      isAdmin: true, // Dev user is admin by default
      maxSandboxes: 100,
    },
  })

  // Create default credentials record
  await prisma.userCredentials.create({
    data: {
      userId: DEV_USER_ID,
      anthropicAuthType: "api-key",
      sandboxAutoStopInterval: 5,
      defaultLoopMaxIterations: 10,
      loopUntilFinishedEnabled: false,
    },
  })

  console.warn("\n" + "=".repeat(60))
  console.warn("GITHUB_PAT: Dev user created successfully!")
  console.warn("Using GitHub PAT for all GitHub operations.")
  console.warn("=".repeat(60) + "\n")
}

/**
 * Log a warning that auth is being skipped (only once per process)
 */
let hasWarnedAboutDevMode = false
export function warnAboutSkippedAuth(): void {
  if (hasWarnedAboutDevMode) return
  hasWarnedAboutDevMode = true

  console.warn("\n" + "!".repeat(60))
  console.warn("WARNING: Running in dev mode (GITHUB_PAT is set)")
  console.warn("Authentication is bypassed. DO NOT use in production!")
  console.warn("!".repeat(60) + "\n")
}
