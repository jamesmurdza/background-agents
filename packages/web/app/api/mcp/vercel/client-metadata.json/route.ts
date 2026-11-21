import { vercelClientMetadata } from "./client-metadata"

// Vercel fetches this document before consent, without a Backgrounder session.
export function GET(): Response {
  const metadata = vercelClientMetadata()
  if (!metadata) return new Response(null, { status: 404 })
  return Response.json(metadata)
}
