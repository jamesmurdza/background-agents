"use client"

import { useEffect, useState } from "react"
import { signIn, useSession } from "next-auth/react"

/**
 * Electron OAuth Start Page
 *
 * This page is opened in the system browser by Electron to complete OAuth.
 * After successful authentication, it generates a JWT token and redirects
 * back to Electron via deep link.
 *
 * Flow:
 * 1. If not authenticated: initiates GitHub OAuth
 * 2. If authenticated: fetches JWT from /api/auth/electron-token
 * 3. Redirects to background-agents://auth?token=<JWT>
 */
export default function ElectronStartPage() {
  const { data: session, status } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [redirecting, setRedirecting] = useState(false)
  const [redirected, setRedirected] = useState(false)

  useEffect(() => {
    if (status === "loading") return

    if (status === "authenticated" && session?.user?.id) {
      // Already authenticated - generate token and redirect to Electron
      generateTokenAndRedirect()
    } else if (status === "unauthenticated") {
      // Not authenticated - start OAuth flow
      // callbackUrl points back to this page after OAuth completes
      signIn("github", {
        callbackUrl: "/auth/electron-start",
      })
    }
  }, [status, session])

  async function generateTokenAndRedirect() {
    if (redirecting) return
    setRedirecting(true)

    try {
      const response = await fetch("/api/auth/electron-token", {
        method: "POST",
        credentials: "include",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to generate token")
      }

      const { token } = await response.json()

      // Redirect to Electron via deep link
      window.location.href = `background-agents://auth?token=${encodeURIComponent(token)}`

      // Mark as redirected and prompt to close
      setRedirected(true)

      // Try to close the window after a short delay
      setTimeout(() => {
        window.close()
      }, 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setRedirecting(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center p-6 max-w-md">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <h1 className="text-xl font-semibold mb-2 text-gray-900">Authentication Error</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => {
              setError(null)
              setRedirecting(false)
              window.location.reload()
            }}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (redirected) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center p-6 max-w-md">
          <div className="text-green-500 text-4xl mb-4">✓</div>
          <h1 className="text-xl font-semibold mb-2 text-gray-900">Signed in successfully!</h1>
          <p className="text-gray-600">You can close this tab and return to the app.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center">
        <div className="animate-spin h-8 w-8 border-2 border-gray-800 border-t-transparent rounded-full mx-auto mb-4" />
        <p className="text-gray-600">
          {status === "loading"
            ? "Loading..."
            : status === "authenticated"
              ? "Redirecting to app..."
              : "Signing in with GitHub..."}
        </p>
      </div>
    </div>
  )
}
