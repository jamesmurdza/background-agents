import { signIn } from "next-auth/react"
import { isElectron } from "@/lib/hooks/useElectron"

// Re-exported for backwards compatibility; the canonical definition lives in useElectron.
export { isElectron }

/**
 * Sign in with GitHub, handling Electron's special OAuth flow
 *
 * In Electron, opens the system browser to /auth/electron-start which:
 * 1. Completes OAuth in the browser (where cookies work reliably)
 * 2. Generates a signed JWT session token
 * 3. Redirects to background-agents://auth?token=<JWT>
 * 4. Electron catches the deep link and sets the session cookie
 */
export function signInWithGitHub() {
  if (isElectron()) {
    // Open system browser to complete OAuth
    // The browser will redirect back via deep link with the session token
    const electronApi = (window as { electron?: { openExternal: (url: string) => void } }).electron
    const authUrl = `${window.location.origin}/auth/electron-start`
    electronApi?.openExternal(authUrl)
  } else {
    signIn("github")
  }
}
