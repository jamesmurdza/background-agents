export function vercelClientMetadata() {
  const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (!baseUrl || !URL.canParse(baseUrl) || new URL(baseUrl).protocol !== "https:") return null

  return {
    client_id: `${baseUrl}/api/mcp/vercel/client-metadata.json`,
    client_name: "Backgrounder",
    client_uri: baseUrl,
    redirect_uris: [`${baseUrl}/api/mcp/connect/vercel/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none" as const,
    scope: "openid offline_access",
  }
}
