"use client"

import { useMutation } from "@tanstack/react-query"

/**
 * Deletes a sandbox.
 * This is a fire-and-forget operation with automatic retries.
 * Errors are logged but not surfaced to the user.
 */
export function useSandboxDeleteMutation() {
  return useMutation({
    mutationFn: async (sandboxId: string): Promise<boolean> => {
      const res = await fetch("/api/sandbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId }),
      })

      // Don't throw on failure - sandbox might already be deleted
      // Just return success/failure status
      return res.ok
    },
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    // No error handling - fire-and-forget cleanup
    onError: (err) => {
      console.warn("Sandbox deletion failed (will retry):", err)
    },
  })
}
