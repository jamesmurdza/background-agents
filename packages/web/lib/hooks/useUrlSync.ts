"use client"

import { useCallback, useEffect, useRef } from "react"
import { ROUTES, matchRoute } from "@/lib/hooks/useUrlNavigation"

// =============================================================================
// useUrlSync — keeps app state in sync with the URL for initial load and
// browser back/forward only.
// =============================================================================
// We use window.history.pushState for in-app navigation to avoid Next.js
// remounting the page component. As a consequence we have to:
//   1. Handle initial page load by syncing URL → state.
//   2. Listen for popstate events (browser back/forward) to sync URL → state.
//
// The interactive handlers (handleSelectChat, etc.) live in the page and update
// state directly + pushState the URL; they don't go through this hook.

interface UseUrlSyncOptions {
  isHydrated: boolean
  currentChatId: string | null
  isDraftChatId: (chatId: string | null) => boolean
  draftChatConfig: { id: string } | null | undefined
  selectChat: (chatId: string | null) => void
  startNewChat: () => Promise<string | null> | void
  setViewMode: (mode: "chat" | "scheduled-jobs") => void
  setSelectedScheduledJob: (job: { id: string; name: string } | null) => void
}

export function useUrlSync({
  isHydrated,
  currentChatId,
  isDraftChatId,
  draftChatConfig,
  selectChat,
  startNewChat,
  setViewMode,
  setSelectedScheduledJob,
}: UseUrlSyncOptions) {
  // Sync URL to state - used for initial load and browser back/forward
  const syncUrlToState = useCallback(
    (isInitialSync: boolean = false) => {
      const currentPath = window.location.pathname
      const matched = matchRoute(currentPath)

      if (!matched) return

      switch (matched.route) {
        case "jobs":
          setViewMode("scheduled-jobs")
          if (!isInitialSync) selectChat(null)
          setSelectedScheduledJob(null)
          break

        case "job":
          setViewMode("scheduled-jobs")
          if (!isInitialSync) selectChat(null)
          // Set selected job with ID (name will be updated when job data loads)
          setSelectedScheduledJob({ id: matched.jobId, name: matched.jobId })
          break

        case "jobRun":
          setViewMode("scheduled-jobs")
          if (!isInitialSync) selectChat(null)
          // Set selected job with ID (name will be updated when job data loads)
          setSelectedScheduledJob({ id: matched.jobId, name: matched.jobId })
          // TODO: Handle run selection when runs view is implemented
          break

        case "newChat":
          setViewMode("chat")
          if (!currentChatId || !isDraftChatId(currentChatId)) {
            startNewChat()
          }
          break

        case "chat": {
          const urlChatId = matched.chatId
          setViewMode("chat")
          if (urlChatId !== currentChatId) {
            // Guard: if the URL contains a draft ID that no longer matches our active
            // draftChatConfig (e.g. a stale URL from a previous session where the draft
            // was already materialized, or a new draft was created), do NOT overwrite
            // currentChatId with the dead draft ID. Redirect the URL instead.
            if (isDraftChatId(urlChatId) && draftChatConfig?.id !== urlChatId) {
              // We have a mismatched draft URL. Use whatever currentChatId localStorage
              // already has, or fall back to /chat/new for a fresh draft.
              const target = currentChatId
                ? ROUTES.chat.build(currentChatId)
                : ROUTES.newChat.build()
              window.history.replaceState(null, "", target)
              if (!currentChatId) startNewChat()
              break
            }
            // Always select the chat - if it doesn't exist in our local cache,
            // the chat detail fetch will handle it. We don't redirect to /chat/new
            // because the chat might exist on the server but not be loaded yet.
            // Also handles draft chats which aren't in the chats array.
            selectChat(urlChatId)
          }
          break
        }

        case "home":
          if (currentChatId) {
            window.history.replaceState(null, "", ROUTES.chat.build(currentChatId))
          } else {
            window.history.replaceState(null, "", ROUTES.newChat.build())
            startNewChat()
          }
          break
      }
    },
    [currentChatId, isDraftChatId, draftChatConfig, selectChat, startNewChat, setViewMode, setSelectedScheduledJob]
  )

  // Track if we've done initial sync
  const initialSyncDone = useRef(false)

  // Initial sync: on first hydrated render, sync URL to state
  useEffect(() => {
    if (!isHydrated || initialSyncDone.current) return
    initialSyncDone.current = true
    syncUrlToState(true)
  }, [isHydrated, syncUrlToState])

  // Store syncUrlToState in a ref so the popstate listener always has access
  // to the latest version without needing to re-add the event listener
  const syncUrlToStateRef = useRef(syncUrlToState)
  useEffect(() => {
    syncUrlToStateRef.current = syncUrlToState
  }, [syncUrlToState])

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    if (!isHydrated) return
    const handlePopState = () => syncUrlToStateRef.current(false)
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [isHydrated])
}
