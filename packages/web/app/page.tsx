"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { signInWithGitHub } from "@/lib/auth-utils"
import { nanoid } from "nanoid"
import { MobileHeader } from "@/components/MobileHeader"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { PreviewView } from "@/components/PreviewView"
import { AppModals } from "@/components/AppModals"
import { useGitDialogs } from "@/components/modals/GitDialogs"
import { ScheduledJobsView } from "@/components/scheduled-jobs/ScheduledJobsView"
import { clearAllStorage } from "@/lib/storage"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { PaletteProvider, usePalette } from "@/components/search-palette"
import { useChatWithSync } from "@/lib/hooks/useChatWithSync"
import { useMobile } from "@/lib/hooks/useMobile"
import { useGitHubTokenCheck } from "@/lib/hooks/useGitHubTokenCheck"
import { usePreview } from "@/lib/hooks/usePreview"
import { usePageTitle } from "@/lib/hooks/usePageTitle"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
import { useUrlSync } from "@/lib/hooks/useUrlSync"
import { useSandboxActions } from "@/lib/hooks/useSandboxActions"
import {
  ChatProvider,
  ModalProvider,
  useModals,
  GitProvider,
  SidebarProvider,
  useSidebar,
  ALL_REPOSITORIES,
  NO_REPOSITORY,
  type ChatContextValue,
  type GitContextValue,
} from "@/lib/contexts"
import { NEW_REPOSITORY, getDefaultAgent, getDefaultModelForAgent, type Agent, type Message, type Chat } from "@/lib/types"
import { useReposQuery, useBranchesQuery, useServersQuery } from "@/lib/query"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import {
  savePendingMessage,
  loadAndClearPendingMessage,
  hasPendingMessage,
} from "@/lib/pending-message"
import { buildTreeOrderedChatIds, getNextChatIdAfterDeletion } from "@/lib/chat-tree"

function ChatPanelWithPalette(props: React.ComponentProps<typeof ChatPanel>) {
  const { openCommand } = usePalette()
  return <ChatPanel {...props} onOpenCommandPalette={openCommand} />
}

// =============================================================================
// HomePage - Wrapper that sets up providers
// =============================================================================
export default function HomePage() {
  const isMobile = useMobile()

  return (
    <SidebarProvider>
      <HomePageWithSidebar isMobile={isMobile} />
    </SidebarProvider>
  )
}

// Inner component that can access sidebar context to pass closeMobileSidebar to ModalProvider
function HomePageWithSidebar({ isMobile }: { isMobile: boolean }) {
  const sidebar = useSidebar()

  return (
    <ModalProvider
      isMobile={isMobile}
      onMobileSidebarClose={sidebar.closeMobileSidebar}
    >
      <HomePageContent isMobile={isMobile} />
    </ModalProvider>
  )
}

// =============================================================================
// HomePageContent - Main content inside providers, can use useModals() and useSidebar()
// =============================================================================
interface HomePageContentProps {
  isMobile: boolean
}

function HomePageContent({ isMobile }: HomePageContentProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { githubTokenInvalid } = useGitHubTokenCheck()
  const modals = useModals()
  const sidebar = useSidebar()

  // Derived route state for page title (uses Next.js pathname for SSR compatibility)
  const isJobsRoute = pathname?.startsWith("/jobs") ?? false
  const isNewChatRoute = pathname === "/chat/new"

  // For jobs, we derive the ID from sidebar state since we use pushState for navigation
  // The sidebar.selectedScheduledJob is updated by handleNavigateToJob
  // Use ?? null to ensure urlJobId is always string | null (never undefined)
  // This keeps ScheduledJobsView in URL-controlled mode so row clicks work
  const urlJobId = sidebar.selectedScheduledJob?.id ?? null

  const {
    chats,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
    claudeLimitResetAt,
    claudeLimitUsed,
    claudeLimitTotal,
    claudeLimitRemaining,
    claudeIsPro,
    claudeIsWeekly,
    isHydrated,
    isLoadingMessages,
    deletingChatIds,
    unseenChatIds,
    startNewChat,
    selectChat,
    removeChat,
    renameChat,
    updateChatRepo,
    updateCurrentChat,
    sendMessage,
    stopAgent,
    updateSettings,
    addMessage,
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
    updateChatById,
    refetchMessages,
    drafts,
    updateDraft,
    clearDraft,
    draftChatConfig,
    isDraftChatId,
    updateDraftChatConfig,
    materializeDraft,
    setOnConflictStateChange,
    limitReachedState,
    setLimitReachedState,
    dismissLimitReached,
    retryWithOpenCode,
  } = useChatWithSync()


  // Additional state not in contexts
  const [scheduledJobsRefreshKey, setScheduledJobsRefreshKey] = useState(0)
  // Track when a message send is initiated (for instant UI feedback before server responds)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  // Optimistic messages shown on a draft chat the instant the user sends, so the
  // view leaves the "new chat" welcome screen immediately instead of waiting for
  // the draft to be materialized on the server. Keyed by the draft's chat id.
  const [optimisticDraft, setOptimisticDraft] = useState<{ chatId: string; messages: Message[] } | null>(null)
  // Rapid fire notification: timestamp of last background task creation, 0 means no notification
  const [rapidFireNotification, setRapidFireNotification] = useState(0)
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)

  // Sandbox/repo actions (env vars, download, open in VS Code/GitHub, git clipboard)
  const {
    isDownloading,
    githubBranchUrl,
    envVarsChatEnvVars,
    envVarsRepoEnvVars,
    handleOpenEnvVars,
    handleSaveEnvVars,
    handleDownloadProject,
    handleOpenInGitHub,
    handleCopyCloneCommand,
    handleCopyCheckoutCommand,
    handleOpenInVSCode,
  } = useSandboxActions({
    currentChat,
    currentChatId,
    chats,
    isDraftChatId,
    onOpenEnvVarsModal: () => modals.setEnvVarsModalOpen(true),
  })

  // Preview state from hook
  const preview = usePreview({
    currentChat,
    updateCurrentChat,
  })

  // Track ports we've already auto-opened in each sandbox so the preview pane
  // only pops open the *first* time a new server appears — not every poll.
  const autoOpenedServersRef = useRef<Map<string, Set<number>>>(new Map())

  // Use TanStack Query for server polling
  const serversQuery = useServersQuery(
    currentChat?.sandboxId,
    currentChat?.previewUrlPattern
  )
  const availableServers = serversQuery.data ?? []

  // Track if we've already processed a pending message (to avoid double-sending)
  const pendingMessageProcessed = useRef(false)

  // Draft chat agent/model — only used when an unauthenticated user is
  // composing a message before any real chat exists. Stored locally because
  // the chat row that would normally hold these doesn't exist yet.
  const [draftAgent, setDraftAgent] = useState<string | null>(null)
  const [draftModel, setDraftModel] = useState<string | null>(null)

  // Per-chat draft message text (stored in localStorage via useChatWithSync)
  // For unauthenticated users (draft mode), we use local component state instead.
  const [draftModeInput, setDraftModeInput] = useState("")

  // Use TanStack Query for repos and branches
  const reposQuery = useReposQuery()
  const repos = reposQuery.data ?? []

  // Parse current repo for branches query
  const [currentOwner, currentRepoName] = (currentChat?.repo ?? "").split("/")
  const branchesQuery = useBranchesQuery(
    currentChat?.repo !== NEW_REPOSITORY ? currentOwner : "",
    currentChat?.repo !== NEW_REPOSITORY ? currentRepoName : ""
  )
  const branches = branchesQuery.data ?? []

  // Auto-open the first *new* server we see in this sandbox
  useEffect(() => {
    const sandboxId = currentChat?.sandboxId
    const chatId = currentChat?.id
    if (!sandboxId || availableServers.length === 0) return

    let seen = autoOpenedServersRef.current.get(sandboxId)
    if (!seen) {
      seen = new Set()
      autoOpenedServersRef.current.set(sandboxId, seen)
    }

    const newServer = availableServers.find((s) => !seen!.has(s.port))
    if (newServer) {
      availableServers.forEach((s) => seen!.add(s.port))
      if (chatId === currentChat?.id) {
        preview.openPreview({ type: "server", port: newServer.port, url: newServer.url })
      }
    }
  }, [availableServers, currentChat?.sandboxId, currentChat?.id, preview.openPreview])

  // Handler for adding messages to current chat
  const handleAddMessage = useCallback((message: Message) => {
    if (currentChatId) {
      addMessage(currentChatId, message)
    }
  }, [currentChatId, addMessage])

  // Git dialogs state - backend creates messages directly in DB
  const gitDialogs = useGitDialogs({
    chat: currentChat ?? null,
    resolveChatName: (branch) => {
      if (!currentChat) return null
      const target = chats.find(
        (c) => c.repo === currentChat.repo && c.branch === branch
      )
      return target?.displayName ?? null
    },
    getTargetSandboxId: (branch) => {
      if (!currentChat) return null
      const target = chats.find(
        (c) => c.id !== currentChat.id && c.repo === currentChat.repo && c.branch === branch
      )
      return target?.sandboxId ?? null
    },
    getTargetChatStatus: (branch) => {
      if (!currentChat) return null
      const target = chats.find(
        (c) => c.id !== currentChat.id && c.repo === currentChat.repo && c.branch === branch
      )
      return target?.status ?? null
    },
    onMarkBranchNeedsSync: (branch) => {
      if (!currentChat) return
      const target = chats.find(
        (c) => c.id !== currentChat.id && c.repo === currentChat.repo && c.branch === branch
      )
      if (target) {
        updateChatById(target.id, { needsSync: true })
      }
    },
    onSetBaseBranch: (branch) => {
      if (!currentChat) return
      updateChatById(currentChat.id, { baseBranch: branch })
    },
    refetchMessages,
  })

  // Connect conflict state updates from SSE to gitDialogs
  // This ensures the warning icon updates after agent resolves conflicts
  useEffect(() => {
    setOnConflictStateChange((state) => {
      gitDialogs.setRebaseConflict(state)
    })
    return () => setOnConflictStateChange(null)
  }, [setOnConflictStateChange, gitDialogs.setRebaseConflict])

  // Close mobile sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      sidebar.setMobileSidebarOpen(false)
    }
  }, [isMobile, sidebar])

  // Auto-select first chat on mobile when no chat is selected
  useEffect(() => {
    if (isMobile && isHydrated && !currentChatId && chats.length > 0) {
      // Sort by last activity and select the most recent
      const sortedChats = [...chats].sort((a, b) =>
        (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt)
      )
      const firstChat = sortedChats[0]
      if (firstChat) {
        selectChat(firstChat.id)
      }
    }
  }, [isMobile, isHydrated, currentChatId, chats, selectChat])


  // Materialize the draft chat when the MCP modal needs to commit a change.
  // Returns the real chatId, or null if materialization failed.
  const handleMaterializeDraftForMcp = useCallback(
    async (draftId: string): Promise<string | null> => {
      const materialized = await materializeDraft(draftId)
      return materialized?.id ?? null
    },
    [materializeDraft]
  )

  // Auto-enter draft mode if user is authenticated but has no chat selected.
  // This replaces the old auto-create behavior - now we just enter draft mode
  // which doesn't create a database record until the first message is sent.
  // Skip when there is a pending message in sessionStorage — the replay effect
  // below will handle chat creation when sending the pending message.
  useEffect(() => {
    if (!isHydrated || currentChatId || !session) return
    if (hasPendingMessage()) return
    // Enter draft mode instead of creating a real chat
    startNewChat()
  }, [isHydrated, currentChatId, session, startNewChat])

  // =============================================================================
  // URL Sync (for initial load and browser back/forward only)
  // =============================================================================
  // Handled by useUrlSync: it syncs URL → state on initial hydrated render and
  // on popstate. Interactive handlers (handleSelectChat, etc.) update state
  // directly and use pushState; they don't go through this hook.
  useUrlSync({
    isHydrated,
    currentChatId,
    isDraftChatId,
    draftChatConfig,
    selectChat,
    startNewChat,
    setViewMode: sidebar.setViewMode,
    setSelectedScheduledJob: sidebar.setSelectedScheduledJob,
  })

  // =============================================================================
  // Draft Chat & Display Chat
  // =============================================================================
  // For users without a real chat (either unauthenticated or authenticated
  // with a draft chat ID), create a synthetic "draft" chat so the UI is
  // interactive. This must be defined before handlers so they can use
  // displayCurrentChat instead of checking isDraftChatId everywhere.
  const unauthDraftIdRef = useRef<string>(`draft-${nanoid()}`)
  const draftChat: Chat | null = useMemo(() => {
    if (!isHydrated) return null

    // Optimistic messages for a just-sent draft (so the conversation view shows
    // instantly while the draft is materialized on the server).
    const messagesFor = (id: string) =>
      optimisticDraft && optimisticDraft.chatId === id ? optimisticDraft.messages : []

    // Case 1: Unauthenticated user - use local draft state
    // This applies when there's no session AND either no chat ID or the chat ID is a draft
    if (!session && (!currentChatId || isDraftChatId(currentChatId))) {
      const resolvedAgent = (draftAgent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
      const resolvedModel = draftModel ?? settings.defaultModel ?? getDefaultModelForAgent(resolvedAgent, credentialFlags)
      return {
        id: currentChatId ?? unauthDraftIdRef.current,
        repo: NEW_REPOSITORY,
        baseBranch: "main",
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: resolvedAgent,
        model: resolvedModel,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "pending",
        displayName: null,
      }
    }

    // Case 2: Authenticated user with a draft chat ID - use draftChatConfig
    if (session && currentChatId && isDraftChatId(currentChatId) && draftChatConfig) {
      const resolvedAgent = (draftChatConfig.agent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
      const resolvedModel = draftChatConfig.model ?? settings.defaultModel ?? getDefaultModelForAgent(resolvedAgent, credentialFlags)
      const messages = messagesFor(currentChatId)
      return {
        id: currentChatId,
        repo: draftChatConfig.repo,
        baseBranch: draftChatConfig.baseBranch,
        branch: null,
        sandboxId: null,
        sessionId: null,
        agent: resolvedAgent,
        model: resolvedModel,
        planModeEnabled: draftChatConfig.planMode ?? false,
        messages,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: messages.length > 0 ? "creating" : "pending",
        displayName: null,
      }
    }

    return null
  }, [isHydrated, session, currentChatId, draftAgent, draftModel, settings.defaultAgent, settings.defaultModel, credentialFlags, isDraftChatId, draftChatConfig, optimisticDraft])

  // Unified current chat - either a real chat or a draft chat
  const displayCurrentChat = isHydrated ? (currentChat ?? draftChat) : null
  const isDraftMode = !!draftChat
  const isAuthenticatedDraft = isDraftMode && !!session

  // Drop optimistic draft messages once we've navigated off that draft — e.g. the
  // draft was materialized into a real chat (currentChatId changed) or the user
  // switched chats. The real chat carries its own optimistic messages by then.
  useEffect(() => {
    if (optimisticDraft && optimisticDraft.chatId !== currentChatId) {
      setOptimisticDraft(null)
    }
  }, [currentChatId, optimisticDraft])

  // Dynamic page title based on current view
  const pageTitle = useMemo(() => {
    if (isJobsRoute) {
      return sidebar.selectedScheduledJob?.name ?? "Scheduled Agents"
    }
    if (displayCurrentChat?.displayName) {
      return displayCurrentChat.displayName
    }
    if (isNewChatRoute || isDraftMode) {
      return "New Chat"
    }
    return null
  }, [isJobsRoute, isNewChatRoute, isDraftMode, displayCurrentChat?.displayName, sidebar.selectedScheduledJob?.name])

  usePageTitle(pageTitle)

  // Clear isSendingMessage once the chat status changes (server responded with optimistic update)
  // or when the user switches to a different chat
  useEffect(() => {
    if (displayCurrentChat?.status === "creating" || displayCurrentChat?.status === "running") {
      setIsSendingMessage(false)
    }
  }, [displayCurrentChat?.status])

  useEffect(() => {
    // Reset sending state when switching chats
    setIsSendingMessage(false)
  }, [displayCurrentChat?.id])

  // =============================================================================
  // Handlers
  // =============================================================================

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
    } else if (sidebar.repoFilter !== ALL_REPOSITORIES && sidebar.repoFilter !== NO_REPOSITORY) {
      // If a specific repo is selected in the filter, use it for the new chat
      // Find the repo to get the default branch
      const repo = repos.find(r => `${r.owner.login}/${r.name}` === sidebar.repoFilter)
      newChatId = await startNewChat(sidebar.repoFilter, repo?.default_branch ?? "main")
    } else {
      // Default to NEW_REPOSITORY (no repo)
      newChatId = await startNewChat()
    }
    // Navigate to the new chat URL
    if (newChatId) {
      // Update URL without triggering Next.js navigation
      window.history.pushState(null, "", ROUTES.chat.build(newChatId))
    }
  }, [session, modals, sidebar, displayCurrentChat, repos, startNewChat])

  // Handler for selecting a chat - switch to chat view and update URL
  const handleSelectChat = useCallback((chatId: string) => {
    // Update state
    selectChat(chatId)
    sidebar.setViewMode("chat")
    sidebar.setSelectedScheduledJob(null)
    // Update URL without triggering Next.js navigation (which causes remount)
    // Using window.history.pushState avoids the component remount that router.push causes
    window.history.pushState(null, "", ROUTES.chat.build(chatId))
  }, [selectChat, sidebar])

  // Handler for opening scheduled jobs view
  const handleOpenScheduledJobs = useCallback(() => {
    // Update state
    sidebar.setViewMode("scheduled-jobs")
    sidebar.setSelectedScheduledJob(null)
    selectChat(null)
    // Update URL without triggering Next.js navigation
    window.history.pushState(null, "", ROUTES.jobs.build())
  }, [sidebar, selectChat])

  // Handler for navigating to a job (updates URL and sidebar state)
  const handleNavigateToJob = useCallback((jobId: string | null, jobName?: string) => {
    if (jobId) {
      // Update sidebar state - use jobName if provided, otherwise use jobId as placeholder
      sidebar.setSelectedScheduledJob({ id: jobId, name: jobName ?? jobId })
      window.history.pushState(null, "", ROUTES.job.build(jobId))
    } else {
      sidebar.setSelectedScheduledJob(null)
      window.history.pushState(null, "", ROUTES.jobs.build())
    }
  }, [sidebar])

  // Handler for the Create Repository palette/slash command.
  const handleCreateRepo = () => {
    if (!session) {
      modals.setSignInModalOpen(true)
      return
    }
    modals.setRepoCreateOpen(true)
  }

  // Handler for repo selection - updates the current chat's repo
  // For draft chats, updates the draft config. For real chats, updates the database.
  // If sandbox already exists (chat started without repo), also set up remote and push
  const handleRepoSelect = async (repo: string, branch: string) => {
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
          const error = await response.json()
          console.error("Failed to set up remote:", error)
          // TODO: Show error to user
          return
        }
      } catch (error) {
        console.error("Failed to set up remote:", error)
        return
      }
    }

    updateChatRepo(displayCurrentChat.id, repo, branch)
  }

  // Handler for sending message
  const handleSendMessage = (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => {
    // Always require sign-in to send messages
    if (!session) {
      // Store the pending message in sessionStorage (persists across OAuth redirect)
      // Note: files cannot be persisted, so we warn the user if they have attachments
      savePendingMessage({ message, agent, model })
      modals.setSignInModalOpen(true)
      return
    }

    // Rapid fire mode: send as background task without switching
    if (settings.rapidFireMode) {
      handleRapidFireSend(message, agent, model, files, planMode)
      return
    }

    // Update filter to match the chat's repo if this is the first message and repo differs from filter
    // This ensures the filter follows the user's choice when starting a chat
    if (displayCurrentChat && displayCurrentChat.messages.length === 0 &&
        sidebar.repoFilter !== ALL_REPOSITORIES && sidebar.repoFilter !== displayCurrentChat.repo) {
      // If chat has no repo, switch to "No repository" filter
      // Otherwise, switch to the chat's repo
      if (displayCurrentChat.repo === NEW_REPOSITORY) {
        sidebar.setRepoFilter(NO_REPOSITORY)
      } else {
        sidebar.setRepoFilter(displayCurrentChat.repo)
      }
    }

    // Set sending state immediately for instant UI feedback
    setIsSendingMessage(true)

    // In draft mode, optimistically render the conversation so the UI leaves the
    // "new chat" welcome screen immediately rather than waiting for the draft to
    // be materialized on the server. (sendMessage materializes the draft, which
    // is a server round-trip, before it can add the real optimistic messages.)
    const draftId = isDraftMode && currentChatId ? currentChatId : null
    if (draftId) {
      // Only the user message is needed to leave the welcome screen
      // (messages.length > 0). The assistant's "thinking" state is shown by the
      // separate `...` indicator driven by the chat's "creating" status.
      setOptimisticDraft({
        chatId: draftId,
        messages: [
          { id: `optimistic-user-${nanoid()}`, role: "user", content: message, timestamp: Date.now() },
        ],
      })
    }

    const sendResult = sendMessage(message, agent, model, files, undefined, planMode)

    // Once the send settles, drop the optimistic draft messages. On success the
    // real chat is already showing (currentChatId changed, so the effect above has
    // cleared them); on failure this reverts the view to the welcome screen.
    if (draftId) {
      void Promise.resolve(sendResult).finally(() => {
        setOptimisticDraft((cur) => (cur && cur.chatId === draftId ? null : cur))
      })
    }
  }

  // Rapid fire: send as a new background chat without switching
  const handleRapidFireSend = useCallback(async (message: string, agent: string, model: string, files?: File[], planMode?: boolean) => {
    if (!session) {
      savePendingMessage({ message, agent, model })
      modals.setSignInModalOpen(true)
      return
    }

    const repo = displayCurrentChat?.repo ?? NEW_REPOSITORY
    const baseBranch = displayCurrentChat?.baseBranch ?? "main"

    const chatId = await startNewChat(repo, baseBranch, undefined, false, "pending", agent, model)
    if (!chatId) return

    sendMessage(message, agent, model, files, chatId, planMode)
    setRapidFireNotification(Date.now())
  }, [session, displayCurrentChat, startNewChat, sendMessage, modals, setRapidFireNotification])

  // After sign-in, replay any pending message saved before the OAuth
  // redirect. Two effects work together to avoid a stale-closure race:
  //   (a) pending-replay: creates the chat, then stages a "pending send"
  //       referencing the new chat ID.
  //   (b) pending-send: fires once `chats` actually contains the new
  //       chat (so sendMessage's state.chats is fresh enough to locate
  //       it). Calls sendMessage and clears the staging state.
  const [pendingSend, setPendingSend] = useState<
    { chatId: string; message: string; agent: string; model: string } | null
  >(null)

  useEffect(() => {
    if (!session || !isHydrated || pendingMessageProcessed.current) return

    const pending = loadAndClearPendingMessage()
    if (!pending) return

    pendingMessageProcessed.current = true
    modals.setSignInModalOpen(false)

    void (async () => {
      let chatId = currentChatId
      if (!chatId) {
        chatId = await startNewChat()
        if (!chatId) return
      }
      // Persist the agent/model picked in draft mode so subsequent
      // messages on this chat use them too. Best-effort.
      updateChatById(chatId, {
        agent: pending.agent,
        model: pending.model,
      }).catch(() => {})
      setPendingSend({
        chatId,
        message: pending.message,
        agent: pending.agent,
        model: pending.model,
      })
    })()
  }, [session, isHydrated, startNewChat, updateChatById, currentChatId, modals])

  useEffect(() => {
    if (!pendingSend) return
    if (!chats.some((c) => c.id === pendingSend.chatId)) return
    const { message, agent, model, chatId } = pendingSend
    setPendingSend(null)
    sendMessage(message, agent, model, undefined, chatId)
  }, [pendingSend, chats, sendMessage])


  // Handler for slash commands - open the corresponding git dialog
  // Start a new chat off the current chat's branch. Defined before
  // handleSlashCommand so "/branch" can call it.
  // Use branch if available (sandbox created), otherwise baseBranch (before first message)
  const branchForNewChat = currentChat?.branch || currentChat?.baseBranch
  const canBranch = !!(branchForNewChat && currentChat?.repo !== NEW_REPOSITORY)

  // Shared helper for creating a background branch and optionally sending a message.
  // Returns false if branch creation is not possible or was aborted.
  const createBranchAndSend = useCallback(async (options?: {
    message?: string
    agent?: string
    model?: string
    /** If true, save the message for retry after sign-in */
    savePendingOnAuth?: boolean
  }): Promise<boolean> => {
    if (!branchForNewChat || currentChat?.repo === NEW_REPOSITORY) return false
    if (!session) {
      if (options?.savePendingOnAuth && options.message && options.agent && options.model) {
        savePendingMessage({ message: options.message, agent: options.agent, model: options.model })
      }
      modals.setSignInModalOpen(true)
      return false
    }
    // When no message is provided, navigate to the new chat
    const navigateToChat = !options?.message
    // Use provided agent/model or inherit from current chat
    const agentToUse = options?.agent ?? currentChat?.agent
    const modelToUse = options?.model ?? currentChat?.model
    // Create new chat in "pending" state (allows sendMessage) without switching to it
    const chatId = await startNewChat(
      currentChat.repo,
      branchForNewChat,
      currentChat.id,
      navigateToChat,
      navigateToChat ? undefined : "pending",
      agentToUse,
      modelToUse
    )
    if (!chatId) return false
    // Send message to the new chat if provided (it runs in background)
    if (options?.message) {
      sendMessage(options.message, options.agent, options.model, undefined, chatId)
    }
    return true
  }, [currentChat, branchForNewChat, startNewChat, sendMessage, session, modals])

  const handleBranchChat = useCallback(() => {
    createBranchAndSend()
  }, [createBranchAndSend])

  // Branch and send a message to the new chat (Option+Enter)
  // The new chat starts in the background - we stay on the current chat
  const handleBranchWithMessage = useCallback(async (message: string, agent: string, model: string) => {
    await createBranchAndSend({ message, agent, model, savePendingOnAuth: true })
  }, [createBranchAndSend])

  // Branch a queued message to a new chat (removes from queue)
  // The new chat starts in the background - we stay on the current chat
  const handleBranchQueuedMessage = useCallback(async (id: string, message: string, agent?: string, model?: string) => {
    // Remove from queue first
    removeQueuedMessage(id)
    await createBranchAndSend({ message, agent, model })
  }, [createBranchAndSend, removeQueuedMessage])

  const handleSlashCommand = useCallback((command: SlashCommandType) => {
    switch (command) {
      case "merge":
        gitDialogs.setMergeOpen(true)
        break
      case "rebase":
        gitDialogs.setRebaseOpen(true)
        break
      case "pr":
        gitDialogs.setPROpen(true)
        break
      case "squash":
        gitDialogs.setSquashOpen(true)
        break
      case "branch":
        handleBranchChat()
        break
      case "abort":
        gitDialogs.handleAbortConflict()
        break
    }
  }, [gitDialogs, handleBranchChat])

  // Palette handlers
  const handlePaletteSelectRepo = useCallback((repo: GitHubRepo) => {
    // Create new chat with the repo - branch selection happens via the header button
    startNewChat(`${repo.owner.login}/${repo.name}`, repo.default_branch)
  }, [startNewChat])

  const handlePaletteSelectBranch = useCallback((repo: GitHubRepo, branch: GitHubBranch) => {
    // Create a new chat with this repo and branch
    startNewChat(`${repo.owner.login}/${repo.name}`, branch.name)
  }, [startNewChat])

  // Command palette handler (wraps handleSlashCommand to accept string)
  const handleRunCommand = useCallback((command: string) => {
    handleSlashCommand(command as SlashCommandType)
  }, [handleSlashCommand])

  // Build the full tree-ordered id list matching the sidebar (ignoring
  // collapsed state — so Alt+Up/Down can reach every chat, expanding
  // collapsed ancestors along the way).
  const treeOrderedChatIds = useMemo(
    () => buildTreeOrderedChatIds(chats, sidebar.repoFilter),
    [chats, sidebar.repoFilter]
  )

  const handleRequestMergeChats = useCallback((sourceId: string, targetId?: string) => {
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
  }, [chats, selectChat, gitDialogs])

  const handleRequestRebaseChat = useCallback((sourceId: string) => {
    const source = chats.find((c) => c.id === sourceId)
    if (!source) return
    selectChat(source.id)
    setTimeout(() => {
      gitDialogs.setSelectedBranch("")
      gitDialogs.setRebaseOpen(true)
    }, 0)
  }, [chats, selectChat, gitDialogs])

  const handleNavigateChat = useCallback((direction: "up" | "down") => {
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
  }, [treeOrderedChatIds, currentChatId, chats, sidebar])

  // Compute the next chat to select after deletion (following chat, or previous if last)
  const getNextChatId = useCallback(
    (deletedIds: string[]) => getNextChatIdAfterDeletion(treeOrderedChatIds, deletedIds),
    [treeOrderedChatIds]
  )

  // Don't render chats until hydrated to avoid SSR mismatch
  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null

  // When in draft mode, agent/model dropdowns route to local draft state
  // because no real chat row exists to PATCH yet.
  const handleUpdateChatProp = useCallback(
    (updates: Partial<Chat>) => {
      if (isDraftMode) {
        if (isAuthenticatedDraft) {
          // Authenticated draft - update via hook (updates both React state and localStorage)
          // Only include defined values to avoid overwriting existing config fields
          const draftUpdates: { agent?: string | null; model?: string | null; repo?: string; baseBranch?: string; planMode?: boolean } = {}
          if (updates.agent !== undefined) draftUpdates.agent = updates.agent
          if (updates.model !== undefined) draftUpdates.model = updates.model
          if (updates.repo !== undefined) draftUpdates.repo = updates.repo
          if (updates.baseBranch !== undefined) draftUpdates.baseBranch = updates.baseBranch
          if (updates.planModeEnabled !== undefined) draftUpdates.planMode = updates.planModeEnabled
          updateDraftChatConfig(draftUpdates)
        } else {
          // Unauthenticated draft - use local component state
          if (updates.agent !== undefined) setDraftAgent(updates.agent)
          if (updates.model !== undefined) setDraftModel(updates.model)
        }
        return
      }
      updateCurrentChat(updates)
    },
    [isDraftMode, isAuthenticatedDraft, updateDraftChatConfig, updateCurrentChat]
  )

  // Per-chat draft handling: in draft mode use local state, otherwise use
  // localStorage-backed drafts keyed by chatId.
  const currentDraft = isDraftMode
    ? draftModeInput
    : (currentChatId ? (drafts[currentChatId] ?? "") : "")

  const handleDraftChange = useCallback((draft: string) => {
    if (isDraftMode) {
      setDraftModeInput(draft)
      return
    }
    if (!currentChatId) return
    updateDraft(currentChatId, draft)
  }, [isDraftMode, currentChatId, updateDraft])

  // Build context values for child components
  const chatContextValue: ChatContextValue = useMemo(() => ({
    currentChat: displayCurrentChat,
    currentChatId: displayCurrentChatId,
    chats: displayChats,
    settings,
    credentialFlags,
    isHydrated,
    isLoadingMessages,
    isSending: isSendingMessage,
    selectChat: handleSelectChat,
    startNewChat,
    removeChat,
    renameChat,
    updateCurrentChat: handleUpdateChatProp,
    updateChatById,
    sendMessage: handleSendMessage,
    stopAgent,
    addMessage: handleAddMessage,
    enqueueMessage,
    removeQueuedMessage,
    resumeQueue,
    drafts,
    updateDraft,
    clearDraft,
    isDraftChatId,
    draftChatConfig,
    updateDraftChatConfig,
    refetchMessages,
    deletingChatIds,
    unseenChatIds,
    updateChatRepo,
  }), [
    displayCurrentChat, displayCurrentChatId, displayChats, settings, credentialFlags,
    isHydrated, isLoadingMessages, isSendingMessage, handleSelectChat, startNewChat,
    removeChat, renameChat, handleUpdateChatProp, updateChatById, handleSendMessage,
    stopAgent, handleAddMessage, enqueueMessage, removeQueuedMessage, resumeQueue,
    drafts, updateDraft, clearDraft, isDraftChatId, draftChatConfig, updateDraftChatConfig,
    refetchMessages, deletingChatIds, unseenChatIds, updateChatRepo,
  ])

  const gitContextValue: GitContextValue = useMemo(() => ({
    ...gitDialogs,
    canBranch,
    handleBranchChat,
    handleBranchWithMessage,
    handleBranchQueuedMessage,
  }), [gitDialogs, canBranch, handleBranchChat, handleBranchWithMessage, handleBranchQueuedMessage])

  // Claude usage data for sidebar user menu
  const claudeUsage = useMemo(() => ({
    used: claudeLimitUsed,
    remaining: claudeLimitRemaining,
    total: claudeLimitTotal,
    isPro: claudeIsPro,
    resetAt: claudeLimitResetAt,
    isWeekly: claudeIsWeekly,
  }), [claudeLimitUsed, claudeLimitRemaining, claudeLimitTotal, claudeIsPro, claudeLimitResetAt, claudeIsWeekly])

  return (
    <PaletteProvider
      repos={repos}
      currentRepo={currentChat?.repo !== NEW_REPOSITORY ? currentChat?.repo ?? null : null}
      branches={branches}
      chats={displayChats.filter((c) => c.displayName !== null).map((c) => ({ id: c.id, displayName: c.displayName, repo: c.repo }))}
      onSelectRepo={handlePaletteSelectRepo}
      onSelectBranch={handlePaletteSelectBranch}
      onRunCommand={handleRunCommand}
      onNewChat={handleNewChat}
      onBranchChat={canBranch ? handleBranchChat : undefined}
      onCreateRepo={currentChat?.repo === NEW_REPOSITORY ? handleCreateRepo : undefined}
      showGitCommands={!!currentChat && currentChat.repo !== NEW_REPOSITORY}
      onOpenInGitHub={githubBranchUrl ? handleOpenInGitHub : undefined}
      onOpenSettings={modals.openSettingsSection}
      onToggleSidebar={!isMobile ? () => sidebar.toggleCollapse() : undefined}
      onSignIn={!session ? () => signInWithGitHub() : undefined}
      onSignOut={session ? () => {
            clearAllStorage()
            signOut()
          } : undefined}
      onDeleteChat={displayCurrentChatId ? () => modals.setDeleteConfirmChatId(displayCurrentChatId) : undefined}
      onOpenInVSCode={currentChat?.sandboxId ? handleOpenInVSCode : undefined}
      onOpenTerminal={
        currentChat?.sandboxId
          ? () => {
              // Generate a unique terminal ID by finding the next available number
              const existingTerminals = preview.previewItems.filter((i) => i.type === "terminal")
              const terminalNumbers = existingTerminals.map((t) => {
                if (t.type !== "terminal") return 0
                const match = t.id.match(/-(\d+)$/)
                return match ? parseInt(match[1], 10) : 1
              })
              const nextNumber = terminalNumbers.length === 0 ? 1 : Math.max(...terminalNumbers) + 1
              preview.openPreview({ type: "terminal", id: `${currentChat.sandboxId}-${nextNumber}` })
            }
          : undefined
      }
      onToggleTerminal={
        currentChat?.sandboxId
          ? () => {
              const existingTerminal = preview.previewItems.find((i) => i.type === "terminal")
              if (existingTerminal) {
                // Terminal exists — toggle pane visibility
                if (preview.previewOpen) {
                  preview.closePreview()
                } else {
                  preview.openPreview(existingTerminal)
                }
              } else {
                // No terminal yet — create one and show it
                preview.openPreview({ type: "terminal", id: `${currentChat.sandboxId}-1` })
              }
            }
          : undefined
      }
      servers={availableServers}
      onOpenServer={(port, url) => preview.openPreview({ type: "server", port, url })}
      onClosePreview={preview.previewOpen ? preview.closePreview : undefined}
      onShowPreview={preview.previewPaneHidden && preview.previewItems.length > 0 ? preview.showPreview : undefined}
      onDownloadProject={currentChat?.sandboxId ? handleDownloadProject : undefined}
      isDownloading={isDownloading}
      onCopyCloneCommand={currentChat?.repo && currentChat.repo !== NEW_REPOSITORY ? handleCopyCloneCommand : undefined}
      onCopyCheckoutCommand={currentChat?.branch ? handleCopyCheckoutCommand : undefined}
      onOpenEnvVars={currentChat ? handleOpenEnvVars : undefined}
      onOpenMcpServers={displayCurrentChatId && session ? () => modals.setMcpServersModalOpen(true) : undefined}
      onOpenSkills={
        currentChat?.sandboxId && currentChat.repo !== NEW_REPOSITORY
          ? () => setSkillsModalOpen((prev) => !prev)
          : undefined
      }
      chatIds={displayChats.map((c) => c.id)}
      onNavigateChat={handleNavigateChat}
      currentChatId={displayCurrentChatId}
      onSelectChat={handleSelectChat}
      rapidFireMode={settings.rapidFireMode}
      onToggleRapidFire={() => updateSettings({ settings: { rapidFireMode: !settings.rapidFireMode } })}
    >
    <ChatProvider value={chatContextValue}>
    <GitProvider value={gitContextValue}>
    <div className={`flex overflow-hidden ${isMobile ? 'h-screen-mobile' : 'h-screen'}`}>
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar
          chats={displayChats}
          currentChatId={displayCurrentChatId}
          deletingChatIds={deletingChatIds}
          unseenChatIds={unseenChatIds}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={(chatId) => removeChat(chatId, getNextChatId)}
          onRenameChat={renameChat}
          collapsed={sidebar.collapsed}
          onToggleCollapse={() => sidebar.toggleCollapse()}
          width={sidebar.width}
          onWidthChange={sidebar.setWidth}
          isMobile={false}
          repoFilter={sidebar.repoFilter}
          onRepoFilterChange={sidebar.setRepoFilter}
          collapsedChatIds={sidebar.collapsedChatIds}
          onToggleChatCollapsed={sidebar.toggleChatCollapsed}
          onRequestMergeChats={handleRequestMergeChats}
          onRequestRebaseChat={handleRequestRebaseChat}
          onOpenScheduledJobs={handleOpenScheduledJobs}
          scheduledJobsActive={sidebar.viewMode === "scheduled-jobs"}
          selectedScheduledJob={sidebar.viewMode === "scheduled-jobs" ? sidebar.selectedScheduledJob : null}
          isLoadingChats={!isHydrated}
          claudeUsage={claudeUsage}
        />
      )}

      {/* Mobile Sidebar (Drawer) */}
      {isMobile && (
        <Sidebar
          chats={displayChats}
          currentChatId={displayCurrentChatId}
          deletingChatIds={deletingChatIds}
          unseenChatIds={unseenChatIds}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={(chatId) => removeChat(chatId, getNextChatId)}
          onRenameChat={renameChat}
          collapsed={false}
          onToggleCollapse={() => {}}
          width={280}
          onWidthChange={() => {}}
          isMobile={true}
          mobileOpen={sidebar.mobileSidebarOpen}
          onMobileClose={() => sidebar.setMobileSidebarOpen(false)}
          repoFilter={sidebar.repoFilter}
          onRepoFilterChange={sidebar.setRepoFilter}
          collapsedChatIds={sidebar.collapsedChatIds}
          onToggleChatCollapsed={sidebar.toggleChatCollapsed}
          onRequestMergeChats={handleRequestMergeChats}
          onRequestRebaseChat={handleRequestRebaseChat}
          onOpenScheduledJobs={() => {
            handleOpenScheduledJobs()
            sidebar.setMobileSidebarOpen(false)
          }}
          scheduledJobsActive={sidebar.viewMode === "scheduled-jobs"}
          selectedScheduledJob={sidebar.viewMode === "scheduled-jobs" ? sidebar.selectedScheduledJob : null}
          isLoadingChats={!isHydrated}
          claudeUsage={claudeUsage}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        {isMobile && (
          <MobileHeader
            chat={displayCurrentChat}
            viewMode={sidebar.viewMode}
            githubBranchUrl={githubBranchUrl}
            onOpenMenu={() => sidebar.setMobileSidebarOpen(true)}
            onOpenInGitHub={handleOpenInGitHub}
            onOpenEnvVars={handleOpenEnvVars}
          />
        )}

        <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              {sidebar.viewMode === "scheduled-jobs" ? (
                <ScheduledJobsView
                  onOpenForm={() => modals.setScheduledJobFormOpen(true)}
                  refreshKey={scheduledJobsRefreshKey}
                  urlJobId={urlJobId}
                  onNavigateToJob={handleNavigateToJob}
                />
              ) : (
                <ChatPanelWithPalette
                  chat={displayCurrentChat}
                  settings={settings}
                  credentialFlags={credentialFlags}
                  showClaudeLimitDialog={() => {
                    setLimitReachedState({
                      show: true,
                      resetAt: claudeLimitResetAt ? new Date(claudeLimitResetAt) : undefined,
                    })
                  }}
                  onSendMessage={handleSendMessage}
                  onEnqueueMessage={enqueueMessage}
                  onRemoveQueuedMessage={removeQueuedMessage}
                  onResumeQueue={resumeQueue}
                  onStopAgent={stopAgent}
                  onUpdateChat={handleUpdateChatProp}
                  onSlashCommand={handleSlashCommand}
                  onOpenFile={(filePath) => {
                    const filename = filePath.split("/").pop() || filePath
                    preview.openPreview({ type: "file", filePath, filename })
                  }}
                  onOpenEnvVars={handleOpenEnvVars}
                  isDraftChat={!!displayCurrentChatId && isDraftChatId(displayCurrentChatId)}
                  onMaterializeDraftForMcp={handleMaterializeDraftForMcp}
                  isMobile={isMobile}
                  isLoadingMessages={isLoadingMessages}
                  draft={currentDraft}
                  onDraftChange={handleDraftChange}
                  isSending={isSendingMessage}
                  isAuthenticated={!!session}
                  rapidFireMode={settings.rapidFireMode}
                  rapidFireNotification={rapidFireNotification}
                />
              )}
            </div>
            {!isMobile && preview.previewOpen && (
              <>
                <div
                  onMouseDown={preview.startPreviewResize}
                  className="group flex-shrink-0 w-1 cursor-col-resize relative"
                  aria-label="Resize preview"
                  role="separator"
                >
                  <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/60 group-hover:bg-border group-active:bg-primary transition-colors" />
                </div>
                <PreviewView
                  style={{ width: preview.previewWidth }}
                  className="flex-shrink-0"
                  item={preview.previewItem}
                  sandboxId={currentChat?.sandboxId ?? null}
                  repo={currentChat?.repo && currentChat.repo !== NEW_REPOSITORY ? currentChat.repo : null}
                  branch={currentChat?.branch ?? currentChat?.baseBranch ?? null}
                  onClose={preview.closePreview}
                  allItems={preview.previewItems}
                  onSelectItem={preview.selectPreviewItem}
                  onCloseItem={preview.closePreviewItem}
                  messages={currentChat?.messages}
                />
              </>
            )}
          </div>
      </div>

      {/* Transparent full-screen shield during split drag so the cursor isn't
          swallowed by iframes or other child elements. */}
      {preview.isResizingPreview && (
        <div className="fixed inset-0 z-[999] cursor-col-resize" />
      )}

      <AppModals
        isMobile={isMobile}
        githubTokenInvalid={githubTokenInvalid}
        onRepoSelect={handleRepoSelect}
        onSaveSettings={updateSettings}
        onSaveEnvVars={handleSaveEnvVars}
        envVarsChatEnvVars={envVarsChatEnvVars}
        envVarsRepoEnvVars={envVarsRepoEnvVars}
        skillsModalOpen={skillsModalOpen}
        onSkillsModalOpenChange={setSkillsModalOpen}
        onScheduledJobSuccess={() => setScheduledJobsRefreshKey((k) => k + 1)}
        onSlashCommand={handleSlashCommand}
        onDeleteChat={(chatId) => removeChat(chatId, getNextChatId)}
        limitReachedState={limitReachedState}
        onDismissLimitReached={dismissLimitReached}
        onContinueWithOpenCode={retryWithOpenCode}
      />
    </div>
    </GitProvider>
    </ChatProvider>
    </PaletteProvider>
  )
}
