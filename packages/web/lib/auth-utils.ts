import { signIn } from "next-auth/react"

/**
 * Check if running in Electron (must be called at runtime, not module load)
 */
export function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as { electron?: unknown }).electron
}

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
  const electron = isElectron()
  console.log("[signInWithGitHub] isElectron:", electron)

  if (electron) {
    // Open system browser to complete OAuth
    // The browser will redirect back via deep link with the session token
    const electronApi = (window as { electron?: { openExternal: (url: string) => void } }).electron
    const authUrl = `${window.location.origin}/auth/electron-start`
    console.log("[signInWithGitHub] Opening system browser:", authUrl)
    electronApi?.openExternal(authUrl)
  } else {
    console.log("[signInWithGitHub] Using default sign-in")
    signIn("github")
  }
}
