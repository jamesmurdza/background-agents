"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

export default function McpCallbackPage() {
  const searchParams = useSearchParams()
  const success = searchParams.get("success") === "true"
  const error = searchParams.get("error")
  const server = searchParams.get("server")

  useEffect(() => {
    // Auto-close popup after success
    if (success) {
      const timer = setTimeout(() => {
        window.close()
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [success])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 text-center">
        {success ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <div>
              <h1 className="text-lg font-semibold text-foreground">Connected!</h1>
              <p className="text-sm text-muted-foreground">
                {server ? `${server} has been` : "MCP server has been"} connected successfully.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This window will close automatically...
              </p>
            </div>
          </>
        ) : error ? (
          <>
            <XCircle className="h-12 w-12 text-red-500" />
            <div>
              <h1 className="text-lg font-semibold text-foreground">Connection Failed</h1>
              <p className="text-sm text-muted-foreground">{error}</p>
              <button
                onClick={() => window.close()}
                className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Processing...</p>
          </>
        )}
      </div>
    </div>
  )
}
