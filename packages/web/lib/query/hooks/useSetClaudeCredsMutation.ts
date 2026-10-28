"use client"

import { useMutation } from "@tanstack/react-query"
import { extractErrorMessage } from "@/lib/fetch-error"

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

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Failed to save Claude credentials"))
  }
  return response.json()
}

export function useSetClaudeCredsMutation() {
  return useMutation({ mutationFn: setClaudeCreds })
}
