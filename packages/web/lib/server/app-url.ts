/**
 * This deployment's own base URL, for building OAuth redirect URIs and
 * other absolute links back to ourselves (e.g. Stripe Checkout's redirect
 * URLs, provider callback URIs).
 */
import "server-only"

export function appBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:4000").replace(/\/$/, "")
}

/** Absolute URL for a path on this deployment. */
export function appUrl(path: string): string {
  return `${appBaseUrl()}${path}`
}
