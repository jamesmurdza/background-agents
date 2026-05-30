"use client"

import { useCallback, useEffect, useState } from "react"
import { NEW_REPOSITORY, type Chat } from "@/lib/types"

interface UseRepoSelectHandlerOptions {
  displayCurrentChat: Chat | null
  isDraftMode: boolean
  updateDraftChatConfig: (updates: { repo?: string; baseBranch?: string }) => void
  updateChatRepo: (chatId: string, repo: string, baseBranch: string) => void
}

interface UseRepoSelectHandlerResult {
  /** Transient error toast text (e.g. setup-remote failure). Auto-dismisses after 5s. */
  errorBanner: string | null
  /**
   * Repo selection handler. For draft chats it just updates the draft config.
   * For real chats whose sandbox already exists without a repo, it sets up the
   * remote (pushing the working branch) before recording the repo on the chat.
   */
  handleRepoSelect: (repo: string, branch: string) => Promise<void>
}

/**
 * Owns the "select a repo for the current chat" flow and the transient error
 * toast it can surface when remote setup fails. Extracted from HomePageContent
 * to keep the page component focused on composition.
 */
export function useRepoSelectHandler({
  displayCurrentChat,
  isDraftMode,
  updateDraftChatConfig,
  updateChatRepo,
}: UseRepoSelectHandlerOptions): UseRepoSelectHandlerResult {
  // Transient error toast (e.g. setup-remote failure). Auto-dismisses after 5s.
  const [errorBanner, setErrorBanner] = useState<string | null>(null)

  useEffect(() => {
    if (!errorBanner) return
    const id = setTimeout(() => setErrorBanner(null), 5000)
    return () => clearTimeout(id)
  }, [errorBanner])

  const handleRepoSelect = useCallback(
    async (repo: string, branch: string) => {
      if (!displayCurrentChat) return

      // For draft chats, just update the draft config
      if (isDraftMode) {
        updateDraftChatConfig({ repo, baseBranch: branch })
        return
      }

      // For real chats - if sandbox exists, we need to set up the remote and push
      if (displayCurrentChat.sandboxId && displayCurrentChat.repo === NEW_REPOSITORY) {
        try {
          const response = await fetch("/api/git/setup-remote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sandboxId: displayCurrentChat.sandboxId,
              repoFullName: repo,
              branch: displayCurrentChat.branch,
            }),
          })

          if (!response.ok) {
            const errJson = await response.json().catch(() => ({}))
            const detail =
              typeof errJson?.error === "string" ? errJson.error : `HTTP ${response.status}`
            console.error("Failed to set up remote:", errJson)
            setErrorBanner(`Couldn't set up remote for ${repo}: ${detail}`)
            return
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Unknown error"
          console.error("Failed to set up remote:", error)
          setErrorBanner(`Couldn't set up remote for ${repo}: ${detail}`)
          return
        }
      }

      updateChatRepo(displayCurrentChat.id, repo, branch)
    },
    [displayCurrentChat, isDraftMode, updateDraftChatConfig, updateChatRepo]
  )

  return { errorBanner, handleRepoSelect }
}
