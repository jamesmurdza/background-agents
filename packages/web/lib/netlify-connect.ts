import { pollUntilPopupCloses } from "@/lib/popup-poll"

/**
 * Opens Netlify's OAuth flow in a popup and resolves once the popup closes.
 * The callback page closes itself after storing the token, so callers refetch
 * whatever reflects the connection (credential flags, deploy status) after this.
 */
export function connectNetlify(): Promise<void> {
  const popup = window.open("/api/netlify/connect", "netlify-connect", "width=600,height=700,scrollbars=yes")
  if (!popup) return Promise.resolve()
  return new Promise((resolve) => pollUntilPopupCloses(popup, resolve))
}
