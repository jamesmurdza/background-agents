/**
 * Connect, poll, and disconnect the Codex ChatGPT subscription.
 *
 * No token material is ever returned to the client — only connection status.
 */
import type { NextRequest } from "next/server"
import { requireAuth, isAuthError, internalError } from "@/lib/db/api-helpers"
import {
  startCodexDeviceLogin,
  pollCodexDeviceLogin,
} from "@/lib/server/codex-login"
import { disconnectCodex, readCodexCredential } from "@/lib/server/codex-credentials"
import { CODEX_SUBSCRIPTION_ENABLED } from "@/lib/codex-credentials"

// The login sandbox takes a few seconds to come up and print the code.
export const maxDuration = 60

function disabled(): Response {
  return Response.json({ error: "CODEX_SUBSCRIPTION_DISABLED" }, { status: 404 })
}

export async function POST(): Promise<Response> {
  if (!CODEX_SUBSCRIPTION_ENABLED) return disabled()
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    return Response.json(await startCodexDeviceLogin(auth.userId))
  } catch (err) {
    const msg = (err as Error).message
    if (msg.startsWith("DEVICE_AUTH_UNAVAILABLE:")) {
      return Response.json(
        { error: "DEVICE_AUTH_UNAVAILABLE", reason: msg.split(":")[1] },
        { status: 409 }
      )
    }
    return internalError(err)
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  if (!CODEX_SUBSCRIPTION_ENABLED) return disabled()
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const sessionId = new URL(req.url).searchParams.get("sessionId")
  if (sessionId) {
    return Response.json(await pollCodexDeviceLogin(auth.userId, sessionId))
  }

  const cred = await readCodexCredential(auth.userId)
  return Response.json({ connected: !!cred, status: cred?.status ?? null })
}

export async function DELETE(): Promise<Response> {
  if (!CODEX_SUBSCRIPTION_ENABLED) return disabled()
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  try {
    await disconnectCodex(auth.userId)
    return Response.json({ ok: true })
  } catch (err) {
    return internalError(err)
  }
}
