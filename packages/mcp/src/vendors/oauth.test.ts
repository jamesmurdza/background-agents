import { describe, expect, it, vi } from "vitest"
import {
  buildAuthorizationUrl,
  discoverOAuthMetadata,
  exchangeAuthorizationCode,
  McpOAuthError,
  pickClientAuthMethod,
  refreshAccessToken,
  registerOAuthClient,
  signOAuthState,
  verifyOAuthState,
  type OAuthClient,
  type OAuthServerMetadata,
} from "./oauth"

type Route = (init?: RequestInit) => Response

/** A fetch stub that answers by exact URL and records every call. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const route = routes[url]
    return route ? route(init) : new Response("not found", { status: 404 })
  })
  return { fetch: fn as unknown as typeof fetch, calls }
}

const json = (body: unknown, status = 200) => () => Response.json(body, { status })

const metadata: OAuthServerMetadata = {
  resource: "https://mcp.example.com/mcp",
  authorizationEndpoint: "https://auth.example.com/authorize",
  tokenEndpoint: "https://auth.example.com/token",
  registrationEndpoint: "https://auth.example.com/register",
  scope: "read offline_access",
  tokenEndpointAuthMethods: ["none"],
}
const publicClient: OAuthClient = { clientId: "client-1", clientSecret: null, authMethod: "none" }

describe("discoverOAuthMetadata", () => {
  it("follows the WWW-Authenticate hints and adds offline_access when supported", async () => {
    const { fetch } = fakeFetch({
      "https://mcp.example.com/mcp": () =>
        new Response(null, {
          status: 401,
          headers: {
            "WWW-Authenticate":
              'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="read write"',
          },
        }),
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": json({
        resource: "https://mcp.example.com/mcp",
        authorization_servers: ["https://auth.example.com"],
        scopes_supported: ["ignored"],
      }),
      "https://auth.example.com/.well-known/oauth-authorization-server": json({
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        scopes_supported: ["read", "write", "offline_access"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      }),
    })

    await expect(discoverOAuthMetadata("https://mcp.example.com/mcp", fetch)).resolves.toEqual({
      resource: "https://mcp.example.com/mcp",
      authorizationEndpoint: "https://auth.example.com/authorize",
      tokenEndpoint: "https://auth.example.com/token",
      registrationEndpoint: "https://auth.example.com/register",
      scope: "read write offline_access",
      tokenEndpointAuthMethods: ["none", "client_secret_post"],
    })
  })

  it("falls back to well-known URLs and the resource's advertised scopes", async () => {
    const { fetch } = fakeFetch({
      "https://mcp.example.com/mcp": () => new Response(null, { status: 401 }),
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp": json({
        authorization_servers: ["https://mcp.example.com"],
        scopes_supported: ["mcp:tools"],
      }),
      "https://mcp.example.com/.well-known/oauth-authorization-server": json({
        authorization_endpoint: "https://mcp.example.com/authorize",
        token_endpoint: "https://mcp.example.com/token",
      }),
    })

    const result = await discoverOAuthMetadata("https://mcp.example.com/mcp", fetch)
    expect(result).toMatchObject({ resource: "https://mcp.example.com/mcp", scope: "mcp:tools", registrationEndpoint: null })
  })

  it("fails clearly when there's no authorization server metadata", async () => {
    const { fetch } = fakeFetch({ "https://mcp.example.com/mcp": () => new Response(null, { status: 401 }) })
    await expect(discoverOAuthMetadata("https://mcp.example.com/mcp", fetch)).rejects.toBeInstanceOf(McpOAuthError)
  })
})

describe("client registration", () => {
  it.each([
    [[], "none"],
    [["client_secret_basic", "none"], "none"],
    [["client_secret_basic", "client_secret_post"], "client_secret_post"],
    [["client_secret_basic"], "client_secret_basic"],
  ])("picks %j -> %s", (supported, expected) => {
    expect(pickClientAuthMethod(supported)).toBe(expected)
  })

  it("registers the redirect URI and keeps a returned client secret", async () => {
    const { fetch, calls } = fakeFetch({
      "https://auth.example.com/register": json({ client_id: "abc", client_secret: "shh", token_endpoint_auth_method: "client_secret_post" }, 201),
    })
    const client = await registerOAuthClient(
      { ...metadata, tokenEndpointAuthMethods: ["client_secret_post"] },
      { clientName: "Backgrounder", redirectUri: "https://app.example.com/callback" },
      fetch
    )
    expect(client).toEqual({ clientId: "abc", clientSecret: "shh", authMethod: "client_secret_post" })
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      client_name: "Backgrounder",
      redirect_uris: ["https://app.example.com/callback"],
      token_endpoint_auth_method: "client_secret_post",
      scope: "read offline_access",
    })
  })
})

describe("authorization code flow", () => {
  it("builds a consent URL with PKCE, state and resource", () => {
    const url = new URL(
      buildAuthorizationUrl(metadata, publicClient, {
        redirectUri: "https://app.example.com/callback",
        state: "signed-state",
        codeChallenge: "challenge",
      })
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://app.example.com/callback",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      state: "signed-state",
      resource: "https://mcp.example.com/mcp",
      scope: "read offline_access",
    })
  })

  it("requires a refresh token from the code exchange", async () => {
    const { fetch } = fakeFetch({ "https://auth.example.com/token": json({ access_token: "a", expires_in: 60 }) })
    await expect(
      exchangeAuthorizationCode(metadata, publicClient, { code: "c", redirectUri: "r", codeVerifier: "v" }, fetch)
    ).rejects.toThrow("refresh token")
  })

  it("returns the rotated refresh token, or keeps the old one", async () => {
    const rotating = fakeFetch({ "https://auth.example.com/token": json({ access_token: "a2", expires_in: 3600, refresh_token: "r2" }) })
    await expect(refreshAccessToken(metadata, publicClient, "r1", rotating.fetch)).resolves.toMatchObject({ accessToken: "a2", refreshToken: "r2" })

    const stable = fakeFetch({ "https://auth.example.com/token": json({ access_token: "a3", expires_in: 3600 }) })
    await expect(refreshAccessToken(metadata, publicClient, "r1", stable.fetch)).resolves.toMatchObject({ accessToken: "a3", refreshToken: "r1" })

    const form = new URLSearchParams(String(rotating.calls[0].init?.body))
    expect(Object.fromEntries(form)).toEqual({
      client_id: "client-1",
      resource: "https://mcp.example.com/mcp",
      grant_type: "refresh_token",
      refresh_token: "r1",
    })
  })

  it("sends a client secret the way the client registered", async () => {
    const post = fakeFetch({ "https://auth.example.com/token": json({ access_token: "a" }) })
    await refreshAccessToken(metadata, { clientId: "id", clientSecret: "s", authMethod: "client_secret_post" }, "r", post.fetch)
    expect(new URLSearchParams(String(post.calls[0].init?.body)).get("client_secret")).toBe("s")

    const basic = fakeFetch({ "https://auth.example.com/token": json({ access_token: "a" }) })
    await refreshAccessToken(metadata, { clientId: "id", clientSecret: "s", authMethod: "client_secret_basic" }, "r", basic.fetch)
    const headers = basic.calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("id:s").toString("base64")}`)
    expect(new URLSearchParams(String(basic.calls[0].init?.body)).has("client_secret")).toBe(false)
  })

  it("reports the OAuth error code on a rejected refresh", async () => {
    const { fetch } = fakeFetch({
      "https://auth.example.com/token": json({ error: "invalid_grant", error_description: "Refresh token revoked" }, 400),
    })
    await expect(refreshAccessToken(metadata, publicClient, "old", fetch)).rejects.toMatchObject({ code: "invalid_grant" })
  })
})

describe("OAuth state", () => {
  it("round-trips its claims and rejects another secret", async () => {
    const claims = { userId: "user-1", vendor: "linear", codeVerifier: "verifier" }
    const state = await signOAuthState("secret-a", claims)
    await expect(verifyOAuthState("secret-a", state)).resolves.toEqual(claims)
    await expect(verifyOAuthState("secret-b", state)).resolves.toBeNull()
  })
})
