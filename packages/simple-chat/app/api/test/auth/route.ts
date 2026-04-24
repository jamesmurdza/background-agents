/**
 * Test-only authentication endpoint
 *
 * Creates a test user and returns a valid session token.
 * ONLY enabled when ENABLE_TEST_AUTH=true (should only be set in test environments)
 */

import { prisma } from "@/lib/db/prisma"
import { encode } from "next-auth/jwt"

export async function POST() {
  // Safety check: only allow in test mode
  if (process.env.ENABLE_TEST_AUTH !== "true") {
    return Response.json(
      { error: "Test auth not enabled. Set ENABLE_TEST_AUTH=true in test environment." },
      { status: 403 }
    )
  }

  // Additional safety: refuse if DATABASE_URL looks like production
  // Can be bypassed with I_KNOW_THIS_IS_THE_TEST_DB=true
  const dbUrl = process.env.DATABASE_URL || ""
  const isTestDb =
    process.env.I_KNOW_THIS_IS_THE_TEST_DB === "true" ||
    dbUrl.includes("test") ||
    dbUrl.includes("localhost") ||
    dbUrl.includes("127.0.0.1")

  if (!isTestDb) {
    return Response.json(
      { error: "Refusing to create test user on non-test database. DATABASE_URL must contain 'test' or be localhost, or set I_KNOW_THIS_IS_THE_TEST_DB=true." },
      { status: 403 }
    )
  }

  try {
    // Create or find test user
    const user = await prisma.user.upsert({
      where: { email: "test@playwright.local" },
      update: {},
      create: {
        email: "test@playwright.local",
        name: "Playwright Test User",
      },
    })

    // Generate session token
    const token = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    })

    return Response.json({
      token,
      userId: user.id,
      email: user.email,
    })
  } catch (error) {
    console.error("Test auth error:", error)
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

// Also support GET for easier testing
export async function GET() {
  return POST()
}
