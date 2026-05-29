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
  selectChat: (chatId: string | null) => void
  startNewChat: () => Promise<string | null> | void
  setViewMode: (mode: "chat" | "scheduled-jobs") => void
  setSelectedScheduledJob: (job: { id: string; name: string } | null) => void
}

export function useUrlSync({
  isHydrated,
  currentChatId,
  isDraftChatId,
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
          // Drafts (new chats) don't get their own URL — show the home page
          // (backgrounder.dev) instead. Enter draft mode if we aren't already in
          // one, then rewrite the URL to "/".
          setViewMode("chat")
          if (!currentChatId || !isDraftChatId(currentChatId)) {
            startNewChat()
          }
          window.history.replaceState(null, "", ROUTES.home.build())
          break

        case "chat": {
          const urlChatId = matched.chatId
          setViewMode("chat")
          // A draft id in the URL (stale link, or an old session's draft) should
          // never stay there. Show the home page and ensure we're in draft mode.
          if (isDraftChatId(urlChatId)) {
            if (!currentChatId || !isDraftChatId(currentChatId)) {
              startNewChat()
            }
            window.history.replaceState(null, "", ROUTES.home.build())
            break
          }
          if (urlChatId !== currentChatId) {
            // Select the chat. If the id is unknown (bad URL), the page-level
            // redirect effect sends the user to a fresh draft once the chat list
            // has loaded. We don't redirect here because the chat might exist on
            // the server but not be loaded yet.
            selectChat(urlChatId)
          }
          break
        }

        case "home":
          setViewMode("chat")
          // A real chat selected at "/" gets promoted to its own URL. Drafts (or
          // no selection) stay on the home page; the auto-draft effect handles
          // entering draft mode when nothing is selected.
          if (currentChatId && !isDraftChatId(currentChatId)) {
            window.history.replaceState(null, "", ROUTES.chat.build(currentChatId))
          } else if (!isInitialSync) {
            // Back/forward navigation to "/" should drop any open chat and show
            // the home page (a fresh draft), not silently keep the chat.
            selectChat(null)
          }
          break
      }
    },
    [currentChatId, isDraftChatId, selectChat, startNewChat, setViewMode, setSelectedScheduledJob]
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
