import { getSharedPoolFlags } from "@/lib/server/credential-flags"
import { internalError } from "@/lib/db/api-helpers"
import type { CredentialFlags } from "@/lib/credentials"

interface SharedPoolResponse {
  /** Server-config-only flags (shared pools available to everyone, no user context). */
  credentialFlags: CredentialFlags
}

// =============================================================================
// GET - Public shared-pool availability (no auth)
// =============================================================================
//
// Exposes only booleans about which shared pools the server has configured, so
// logged-out visitors can see the agent picker's shared-pool "ready" dots
// before signing in. Never returns key values or any user-specific data.

export async function GET(): Promise<Response> {
  try {
    const credentialFlags = await getSharedPoolFlags()
    const response: SharedPoolResponse = { credentialFlags }
    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
