import type { Daytona, Sandbox } from "@daytonaio/sdk"

/**
 * Shared sandbox-lifecycle contract.
 *
 * Single source of truth for what "stopped" and "expired" mean across the
 * `/api/sandbox/*` routes (server) and the preview panels (client). Panels must
 * never re-encode these HTTP codes or error strings inline.
 */

/** Lifecycle state a panel can be in (besides "ready"). */
export type SandboxState = "ready" | "stopped" | "expired"

/** HTTP status codes that carry lifecycle meaning. */
const SANDBOX_HTTP = {
  /** Sandbox exists but is not running, and the caller didn't ask to boot it. */
  STOPPED: 409,
  /** Sandbox no longer exists (deleted / auto-expired). */
  EXPIRED: 410,
} as const

/** Machine-readable error codes returned in the JSON body. */
const SANDBOX_ERROR = {
  STOPPED: "SANDBOX_STOPPED",
  NOT_FOUND: "SANDBOX_NOT_FOUND",
} as const

// =============================================================================
// Server helpers
// =============================================================================

/** 409 — the sandbox is stopped and the request was passive (no autoStart). */
function sandboxStoppedResponse(): Response {
  return Response.json({ error: SANDBOX_ERROR.STOPPED }, { status: SANDBOX_HTTP.STOPPED })
}

/** 410 — the sandbox no longer exists. */
function sandboxExpiredResponse(): Response {
  return Response.json({ error: SANDBOX_ERROR.NOT_FOUND }, { status: SANDBOX_HTTP.EXPIRED })
}

/**
 * Resolve a sandbox by id, or return a 410 Response if it no longer exists.
 * Centralizes the `daytona.get` + not-found handling shared by every route.
 *
 * Usage:
 *   const sandbox = await getSandboxOrExpired(daytona, sandboxId)
 *   if (sandbox instanceof Response) return sandbox
 */
export async function getSandboxOrExpired(
  daytona: Daytona,
  sandboxId: string
): Promise<Sandbox | Response> {
  try {
    return await daytona.get(sandboxId)
  } catch {
    return sandboxExpiredResponse()
  }
}

/**
 * Lifecycle gate for passive reads. A stopped sandbox must only be booted by an
 * explicit user action (`autoStart`), never by background/passive traffic.
 *
 * Returns a 409 Response to halt when the sandbox is stopped and the caller is
 * passive; returns null to proceed (caller then runs `ensureSandboxStarted`).
 */
export function passiveReadGate(
  sandbox: Sandbox,
  autoStart: boolean | undefined
): Response | null {
  if (sandbox.state !== "started" && !autoStart) {
    return sandboxStoppedResponse()
  }
  return null
}

// =============================================================================
// Client helper
// =============================================================================

/**
 * Classify a fetch Response from a `/api/sandbox/*` route into a lifecycle
 * outcome. Panels switch on this instead of checking magic status codes.
 */
export function classifyResponse(
  res: Response
): { kind: "ok" } | { kind: "state"; state: Exclude<SandboxState, "ready"> } | { kind: "error" } {
  if (res.ok) return { kind: "ok" }
  if (res.status === SANDBOX_HTTP.STOPPED) return { kind: "state", state: "stopped" }
  if (res.status === SANDBOX_HTTP.EXPIRED) return { kind: "state", state: "expired" }
  return { kind: "error" }
}
