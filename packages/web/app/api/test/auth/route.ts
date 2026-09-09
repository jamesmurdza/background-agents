/**
 * Test-only authentication endpoint
 *
 * Creates a test user and returns a valid session token.
 * ONLY enabled when ENABLE_TEST_AUTH=true (should only be set in test environments)
 *
 * An optional `?user=<tag>` query param picks a distinct, stable test user
 * (`test-<tag>@playwright.local`) instead of the default `test@playwright.local`.
 * IDOR-style specs use this to get a second real user id to test ownership
 * scoping against, rather than asserting against the same user twice.
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { encode } from "next-auth/jwt"
import { internalError } from "@/lib/db/api-helpers"

export async function POST(req: NextRequest) {
  // Safety check: only allow in test mode
  if (process.env.ENABLE_TEST_AUTH !== "true") {
    return Response.json(
      { error: "Test auth not enabled. Set ENABLE_TEST_AUTH=true in test environment." },
      { status: 403 }
    )
  }

  try {
    const rawTag = new URL(req.url).searchParams.get("user")
    if (rawTag && !/^[a-z0-9-]{1,32}$/.test(rawTag)) {
      return Response.json({ error: "Invalid user tag" }, { status: 400 })
    }
    const tag = rawTag
    const email = tag ? `test-${tag}@playwright.local` : "test@playwright.local"
    const name = tag ? `Playwright Test User ${tag.toUpperCase()}` : "Playwright Test User"

    // Create or find test user
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name },
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
    return internalError(error)
  }
}

// Also support GET for easier testing
export async function GET(req: NextRequest) {
  return POST(req)
}
