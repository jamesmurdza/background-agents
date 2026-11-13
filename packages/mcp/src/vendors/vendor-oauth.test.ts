import { createHash } from "crypto"
import { describe, expect, it, vi } from "vitest"
import { createVendorOAuth } from "./vendor-oauth"
import type { McpVendor } from "./list"

const vendor: McpVendor = {
  slug: "acme",
  name: "Acme",
  description: "Test vendor",
  mcpUrl: "https://mcp.acme.test/mcp",
  iconUrl: "https://acme.test/favicon.ico",
}

/** A fake vendor: MCP endpoint, OAuth metadata, registration and token endpoints. */
function fakeVendor() {
  const calls: { url: string; init?: RequestInit }[] = []
  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    switch (url) {
      case "https://mcp.acme.test/mcp":
        return new Response(null, { status: 401, headers: { "WWW-Authenticate": 'Bearer scope="read"' } })
      case "https://mcp.acme.test/.well-known/oauth-protected-resource/mcp":
        return json({ resource: "https://mcp.acme.test/mcp", authorization_servers: ["https://auth.acme.test"] })
      case "https://auth.acme.test/.well-known/oauth-authorization-server":
        return json({
          authorization_endpoint: "https://auth.acme.test/authorize",
          token_endpoint: "https://auth.acme.test/token",
          registration_endpoint: "https://auth.acme.test/register",
          token_endpoint_auth_methods_supported: ["none"],
        })
      case "https://auth.acme.test/register":
        return json({ client_id: "client-1" }, 201)
      case "https://auth.acme.test/token":
        return json({ access_token: "access-1", expires_in: 3600, refresh_token: "refresh-1" })
      default:
        return new Response("not found", { status: 404 })
    }
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const redirectUri = "https://app.test/oauth/acme/callback"

describe("createVendorOAuth", () => {
  it("runs the whole login: register, consent URL, callback", async () => {
    const { fetch, calls } = fakeVendor()
    const oauth = createVendorOAuth({ clientName: "Test App", stateSecret: "secret", fetch })

    const client = await oauth.registerClient(vendor, { redirectUri })
    expect(client).toEqual({ clientId: "client-1", clientSecret: null, authMethod: "none" })

    const url = new URL(await oauth.authorizationUrl(vendor, client, { redirectUri, userId: "user-1" }))
    expect(url.origin + url.pathname).toBe("https://auth.acme.test/authorize")
    const state = url.searchParams.get("state")!
    const challenge = url.searchParams.get("code_challenge")!

    const { userId, tokens } = await oauth.handleCallback(vendor, client, { redirectUri, code: "code-1", state })
    expect(userId).toBe("user-1")
    expect(tokens).toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1" })

    // The verifier carried in the state matches the challenge the vendor saw.
    const form = new URLSearchParams(String(calls.find((c) => c.url.endsWith("/token"))!.init?.body))
    const verifier = form.get("code_verifier")!
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge)
    expect(form.get("redirect_uri")).toBe(redirectUri)
  })

  it("rejects a state issued for another vendor or signed with another secret", async () => {
    const { fetch } = fakeVendor()
    const oauth = createVendorOAuth({ clientName: "Test App", stateSecret: "secret", fetch })
    const client = { clientId: "client-1", clientSecret: null, authMethod: "none" as const }
    const other = { ...vendor, slug: "other" }

    const forOther = new URL(await oauth.authorizationUrl(other, client, { redirectUri, userId: "user-1" }))
    await expect(
      oauth.handleCallback(vendor, client, { redirectUri, code: "c", state: forOther.searchParams.get("state")! })
    ).rejects.toMatchObject({ code: "invalid_state" })

    const forged = createVendorOAuth({ clientName: "Test App", stateSecret: "other-secret", fetch })
    const forgedUrl = new URL(await forged.authorizationUrl(vendor, client, { redirectUri, userId: "user-1" }))
    await expect(
      oauth.handleCallback(vendor, client, { redirectUri, code: "c", state: forgedUrl.searchParams.get("state")! })
    ).rejects.toMatchObject({ code: "invalid_state" })
  })

  it("looks up a vendor's OAuth metadata once and reuses it", async () => {
    const { fetch, calls } = fakeVendor()
    const oauth = createVendorOAuth({ clientName: "Test App", stateSecret: "secret", fetch })
    const client = await oauth.registerClient(vendor, { redirectUri })
    await oauth.authorizationUrl(vendor, client, { redirectUri, userId: "user-1" })
    await oauth.refresh(vendor, client, "refresh-1")
    expect(calls.filter((c) => c.url === "https://mcp.acme.test/mcp")).toHaveLength(1)
  })
})
