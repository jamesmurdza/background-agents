import { Daytona } from "@daytonaio/sdk"

/**
 * Reads `DAYTONA_API_KEY` from the environment and returns a Daytona client.
 *
 * When the key is not configured, returns a 500 `Response` instead so callers
 * can bail out with the same `instanceof Response` pattern used by the other
 * API helpers (e.g. `requireSandboxOwner`, `getSandboxOrExpired`):
 *
 * ```ts
 * const daytona = getDaytonaClient()
 * if (daytona instanceof Response) return daytona
 * ```
 */
export function getDaytonaClient(): Daytona | Response {
  const apiKey = process.env.DAYTONA_API_KEY
  if (!apiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }
  return new Daytona({ apiKey })
}
