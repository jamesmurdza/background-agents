"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import type { Session } from "next-auth"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import {
  ALL_REPOSITORIES,
  NO_REPOSITORY,
  type SidebarContextValue,
} from "@/lib/contexts"
import { NEW_REPOSITORY, type Chat, type ChatStatus } from "@/lib/types"
import type { GitHubRepo } from "@/lib/github"
import { buildTreeOrderedChatIds, getNextChatIdAfterDeletion } from "@/lib/chat-tree"

/** The git-dialog setters the merge/rebase request handlers need. */
interface GitDialogControls {
  setMergeOpen: (open: boolean) => void
  setRebaseOpen: (open: boolean) => void
  setSelectedBranch: (branch: string) => void
}

interface UseChatNavigationOptions {
  isHydrated: boolean
  isLoading: boolean
  session: Session | null
  modals: { setSignInModalOpen: (open: boolean) => void }
  sidebar: SidebarContextValue
  chats: Chat[]
  currentChatId: string | null
  displayCurrentChat: Chat | null
  repos: GitHubRepo[]
  isDraftChatId: (chatId: string) => boolean
  selectChat: (chatId: string | null) => void
  startNewChat: (
    repo?: string,
    baseBranch?: string,
    parentChatId?: string,
    switchTo?: boolean,
    initialStatus?: ChatStatus,
    agent?: string | null,
    model?: string | null
  ) => Promise<string | null>
  gitDialogs: GitDialogControls
}

interface UseChatNavigationResult {
  /** Tree-ordered chat id list matching the sidebar (ignores collapsed state). */
  treeOrderedChatIds: string[]
  handleNewChat: () => Promise<void>
  handleSelectChat: (chatId: string) => void
  handleOpenScheduledJobs: () => void
  handleNavigateToJob: (jobId: string | null, jobName?: string) => void
  handleNavigateChat: (direction: "up" | "down") => void
  handleRequestMergeChats: (sourceId: string, targetId?: string) => void
  handleRequestRebaseChat: (sourceId: string) => void
  /** Compute which chat to select after deleting the given ids. */
  getNextChatId: (deletedIds: string[]) => string | null
}

/**
 * Owns chat/job navigation: the click handlers that switch views and push
 * history, keyboard chat traversal, merge/rebase requests from the sidebar, and
 * the two URL-reconciliation effects (promote a materialized draft's URL, and
 * redirect away from a stale/unknown chat id). Extracted from HomePageContent
 * so the page stays focused on composition.
 */
export function useChatNavigation({
  isHydrated,
  isLoading,
  session,
  modals,
  sidebar,
  chats,
  currentChatId,
  displayCurrentChat,
  repos,
  isDraftChatId,
  selectChat,
  startNewChat,
  gitDialogs,
}: UseChatNavigationOptions): UseChatNavigationResult {
  // Handler for selecting a chat - switch to chat view and update URL
  const handleSelectChat = useCallback(
    (chatId: string) => {
      selectChat(chatId)
      sidebar.setViewMode("chat")
      sidebar.setSelectedScheduledJob(null)
      // Update URL without triggering Next.js navigation (which causes remount).
      // Using window.history.pushState avoids the component remount router.push causes.
      window.history.pushState(null, "", ROUTES.chat.build(chatId))
    },
    [selectChat, sidebar]
  )

  // Handler for new chat - uses current chat's repo/branch if available, otherwise repo filter
  const handleNewChat = useCallback(async () => {
    if (!session) {
      modals.setSignInModalOpen(true)
      return
    }
    // Switch to chat view
    sidebar.setViewMode("chat")
    sidebar.setSelectedScheduledJob(null) // Clear selected job when switching to chat
    // If there's a current chat (real or draft) with a repo selected, inherit its repo and base branch.
    // Sibling chat — no parentChatId, and use baseBranch (not the working branch) so the
    // new chat starts from the same point the current one did.
    let newChatId: string | null = null
    if (displayCurrentChat && displayCurrentChat.repo !== NEW_REPOSITORY) {
      newChatId = await startNewChat(displayCurrentChat.repo, displayCurrentChat.baseBranch)
    } else if (
      sidebar.repoFilter !== ALL_REPOSITORIES &&
      sidebar.repoFilter !== NO_REPOSITORY
    ) {
      // If a specific repo is selected in the filter, use it for the new chat.
      // Find the repo to get the default branch.
      const repo = repos.find((r) => `${r.owner.login}/${r.name}` === sidebar.repoFilter)
      newChatId = await startNewChat(sidebar.repoFilter, repo?.default_branch ?? "main")
    } else {
      // Default to NEW_REPOSITORY (no repo)
      newChatId = await startNewChat()
    }
    // New chats are drafts — they don't get their own URL. Show the home page
    // instead of putting the draft id in the URL. Pushing a history entry keeps
    // the back button working (returns to the prior chat).
    if (newChatId) {
      window.history.pushState(null, "", ROUTES.home.build())
    }
  }, [session, modals, sidebar, displayCurrentChat, repos, startNewChat])

  // Handler for opening scheduled jobs view
  const handleOpenScheduledJobs = useCallback(() => {
    sidebar.setViewMode("scheduled-jobs")
    sidebar.setSelectedScheduledJob(null)
    selectChat(null)
    window.history.pushState(null, "", ROUTES.jobs.build())
  }, [sidebar, selectChat])

  // Handler for navigating to a job (updates URL and sidebar state)
  const handleNavigateToJob = useCallback(
    (jobId: string | null, jobName?: string) => {
      if (jobId) {
        // Use jobName if provided, otherwise use jobId as placeholder
        sidebar.setSelectedScheduledJob({ id: jobId, name: jobName ?? jobId })
        window.history.pushState(null, "", ROUTES.job.build(jobId))
      } else {
        sidebar.setSelectedScheduledJob(null)
        window.history.pushState(null, "", ROUTES.jobs.build())
      }
    },
    [sidebar]
  )

  // Build the full tree-ordered id list matching the sidebar (ignoring
  // collapsed state — so Alt+Up/Down can reach every chat, expanding
  // collapsed ancestors along the way).
  const treeOrderedChatIds = useMemo(
    () => buildTreeOrderedChatIds(chats, sidebar.repoFilter),
    [chats, sidebar.repoFilter]
  )

  const handleRequestMergeChats = useCallback(
    (sourceId: string, targetId?: string) => {
      const source = chats.find((c) => c.id === sourceId)
      const target = targetId ? chats.find((c) => c.id === targetId) : null
      if (!source) return
      selectChat(source.id)
      setTimeout(() => {
        if (target?.branch) {
          gitDialogs.setSelectedBranch(target.branch)
        } else {
          gitDialogs.setSelectedBranch("")
        }
        gitDialogs.setMergeOpen(true)
      }, 0)
    },
    [chats, selectChat, gitDialogs]
  )

  const handleRequestRebaseChat = useCallback(
    (sourceId: string) => {
      const source = chats.find((c) => c.id === sourceId)
      if (!source) return
      selectChat(source.id)
      setTimeout(() => {
        gitDialogs.setSelectedBranch("")
        gitDialogs.setRebaseOpen(true)
      }, 0)
    },
    [chats, selectChat, gitDialogs]
  )

  const handleNavigateChat = useCallback(
    (direction: "up" | "down") => {
      if (treeOrderedChatIds.length === 0) return
      const idx = currentChatId ? treeOrderedChatIds.indexOf(currentChatId) : -1
      let nextIdx: number
      if (direction === "up") {
        nextIdx = idx <= 0 ? treeOrderedChatIds.length - 1 : idx - 1
      } else {
        nextIdx = idx >= treeOrderedChatIds.length - 1 ? 0 : idx + 1
      }
      const nextId = treeOrderedChatIds[nextIdx]
      if (!nextId) return
      // If the target is inside a collapsed parent, expand up the chain.
      const byId = new Map(chats.map((c) => [c.id, c]))
      sidebar.expandChatAndAncestors(nextId, byId)
      handleSelectChat(nextId)
    },
    [treeOrderedChatIds, currentChatId, chats, sidebar, handleSelectChat]
  )

  // Compute the next chat to select after deletion (following chat, or previous if last)
  const getNextChatId = useCallback(
    (deletedIds: string[]) => getNextChatIdAfterDeletion(treeOrderedChatIds, deletedIds),
    [treeOrderedChatIds]
  )

  // When a draft is materialized into a real chat (e.g. after sending the first
  // message), the draft id is replaced by a real one. Drafts live at the home
  // page URL, so promote the URL to /chat/{realId} once it becomes a real chat.
  const prevChatIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prevId = prevChatIdRef.current
    prevChatIdRef.current = currentChatId
    if (!isHydrated || sidebar.viewMode !== "chat") return
    if (
      currentChatId &&
      !isDraftChatId(currentChatId) &&
      prevId &&
      isDraftChatId(prevId)
    ) {
      const target = ROUTES.chat.build(currentChatId)
      if (window.location.pathname !== target) {
        window.history.replaceState(null, "", target)
      }
    }
  }, [isHydrated, currentChatId, isDraftChatId, sidebar.viewMode])

  // If the URL points at a chat that doesn't exist (bad/stale link), redirect to
  // a fresh draft on the home page. We only do this once the chat list has
  // finished loading — until then we can't tell "missing" from "not loaded yet".
  useEffect(() => {
    if (!isHydrated || isLoading) return
    if (sidebar.viewMode !== "chat") return
    if (!currentChatId || isDraftChatId(currentChatId)) return
    if (chats.some((c) => c.id === currentChatId)) return
    // Unknown chat id — drop it and let the auto-draft effect enter draft mode.
    selectChat(null)
    window.history.replaceState(null, "", ROUTES.home.build())
  }, [isHydrated, isLoading, currentChatId, chats, isDraftChatId, sidebar.viewMode, selectChat])

  return {
    treeOrderedChatIds,
    handleNewChat,
    handleSelectChat,
    handleOpenScheduledJobs,
    handleNavigateToJob,
    handleNavigateChat,
    handleRequestMergeChats,
    handleRequestRebaseChat,
    getNextChatId,
  }
}
