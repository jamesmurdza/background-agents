"use client"

import { useMutation } from "@tanstack/react-query"

export interface SetClaudeCredsResult {
  saved: true
  expiresAt?: number
}

/** Stores a hand-pasted ~/.claude/.credentials.json as the shared credentials. */
async function setClaudeCreds(credentials: string): Promise<SetClaudeCredsResult> {
  const response = await fetch("/api/admin/refresh-claude-creds", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentials }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      data.message || data.error || "Failed to save Claude credentials",
    )
  }
  return data
}

export function useSetClaudeCredsMutation() {
  return useMutation({ mutationFn: setClaudeCreds })
}
