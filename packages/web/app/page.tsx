"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { usePathname, useParams } from "next/navigation"
import { useSession, signIn, signOut } from "next-auth/react"
import { nanoid } from "nanoid"
import { MobileHeader } from "@/components/MobileHeader"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { PreviewView } from "@/components/PreviewView"
import { RepoPickerModal } from "@/components/modals/RepoPickerModal"
import { SettingsModal } from "@/components/modals/SettingsModal"
import { SignInModal } from "@/components/modals/SignInModal"
import { ReAuthModal } from "@/components/modals/ReAuthModal"
import { HelpModal } from "@/components/modals/HelpModal"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { LimitReachedDialog } from "@/components/modals/LimitReachedDialog"
import { MergeDialog, RebaseDialog, PRDialog, SquashDialog, ForcePushDialog, useGitDialogs } from "@/components/modals/GitDialogs"
import { EnvironmentVariablesModal } from "@/components/modals/EnvironmentVariablesModal"
import { McpServersModal } from "@/components/modals/McpServersModal"
import { MobileCommandsMenu } from "@/components/MobileCommandsMenu"
import { MobileRenameModal } from "@/components/ui/MobileBottomSheet"
import { ScheduledJobForm } from "@/components/scheduled-jobs/ScheduledJobForm"
import { ScheduledJobsView } from "@/components/scheduled-jobs/ScheduledJobsView"
import { SkillSearchView } from "@/components/skills/SkillSearchView"
import { clearAllStorage } from "@/lib/storage"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { PaletteProvider, usePalette } from "@/components/search-palette"
import { useChatWithSync } from "@/lib/hooks/useChatWithSync"
import { useMobile } from "@/lib/hooks/useMobile"
import { useGitHubTokenCheck } from "@/lib/hooks/useGitHubTokenCheck"
import { usePreview } from "@/lib/hooks/usePreview"
import { usePageTitle } from "@/lib/hooks/usePageTitle"
import { ROUTES } from "@/lib/hooks/useUrlNavigation"
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
import { PATHS } from "@upstream/common"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"

// Storage key for pending message (persists across OAuth redirect)
const PENDING_MESSAGE_KEY = "simple-chat-pending-message"

// Type for pending message data stored before sign-in
interface PendingMessage {
  message: string
  agent: string
  model: string
}

// Helper to save pending message to sessionStorage
function savePendingMessage(data: PendingMessage): void {
  if (typeof window !== "undefined") {
    sessionStorage.setItem(PENDING_MESSAGE_KEY, JSON.stringify(data))
  }
}

// Helper to load and clear pending message from sessionStorage
function loadAndClearPendingMessage(): PendingMessage | null {
  if (typeof window === "undefined") return null
  const stored = sessionStorage.getItem(PENDING_MESSAGE_KEY)
  if (stored) {
    sessionStorage.removeItem(PENDING_MESSAGE_KEY)
    try {
      return JSON.parse(stored) as PendingMessage
    } catch {
      return null
    }
  }
  return null
}

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
  const params = useParams()
  const { data: session } = useSession()
  const { githubTokenInvalid } = useGitHubTokenCheck()
  const modals = useModals()
  const sidebar = useSidebar()

  // URL params for jobs (used by ScheduledJobsView)
  const urlJobId = params?.jobId as string | undefined

  // Derived route state for page title
  const isJobsRoute = pathname?.startsWith("/jobs") ?? false
  const isNewChatRoute = pathname === "/chat/new"

  const {
    chats,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
    claudeLimitResetAt,
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
  const [envVarsChatEnvVars, setEnvVarsChatEnvVars] = useState<Record<string, string>>({})
  const [envVarsRepoEnvVars, setEnvVarsRepoEnvVars] = useState<Record<string, string>>({})
  const [scheduledJobsRefreshKey, setScheduledJobsRefreshKey] = useState(0)
  // Track when a message send is initiated (for instant UI feedback before server responds)
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  // Rapid fire notification: timestamp of last background task creation, 0 means no notification
  const [rapidFireNotification, setRapidFireNotification] = useState(0)
  const [isDownloading, setIsDownloading] = useState(false)
  const [skillsModalOpen, setSkillsModalOpen] = useState(false)

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


  // Handler for opening environment variables modal
  const handleOpenEnvVars = useCallback(async () => {
    if (!currentChatId || isDraftChatId(currentChatId)) return

    try {
      // Fetch chat env vars
      const chatRes = await fetch(`/api/chats/${currentChatId}/env`)
      const chatData = chatRes.ok ? await chatRes.json() : { environmentVariables: {} }

      // Fetch repo env vars
      const repoRes = await fetch("/api/user/repo-env")
      const repoData = repoRes.ok ? await repoRes.json() : { repoEnvironmentVariables: {} }

      const chat = chats.find((c) => c.id === currentChatId)
      const repoName = chat?.repo !== NEW_REPOSITORY ? chat?.repo : undefined

      setEnvVarsChatEnvVars(chatData.environmentVariables || {})
      setEnvVarsRepoEnvVars(repoName && repoData.repoEnvironmentVariables?.[repoName] || {})
      modals.setEnvVarsModalOpen(true)
    } catch (error) {
      console.error("Failed to fetch environment variables:", error)
    }
  }, [currentChatId, isDraftChatId, chats, modals])

  // Handler for saving environment variables
  const handleSaveEnvVars = useCallback(async (chatEnvVars: Record<string, string>, repoEnvVars: Record<string, string>) => {
    if (!currentChatId || isDraftChatId(currentChatId)) return

    const chat = chats.find((c) => c.id === currentChatId)
    const repoName = chat?.repo !== NEW_REPOSITORY ? chat?.repo : undefined

    // Save chat env vars
    await fetch(`/api/chats/${currentChatId}/env`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environmentVariables: chatEnvVars }),
    })

    // Save repo env vars if applicable
    if (repoName) {
      await fetch("/api/user/repo-env", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoName, environmentVariables: repoEnvVars }),
      })
    }
  }, [currentChatId, isDraftChatId, chats])

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
    if (typeof window !== "undefined" && sessionStorage.getItem(PENDING_MESSAGE_KEY)) return
    // Enter draft mode instead of creating a real chat
    startNewChat()
  }, [isHydrated, currentChatId, session, startNewChat])

  // =============================================================================
  // URL Sync (for initial load and browser back/forward only)
  // =============================================================================
  // We use window.history.pushState for navigation to avoid Next.js remounting
  // the component. This means we need to:
  // 1. Handle initial page load by syncing URL → state
  // 2. Listen for popstate events (browser back/forward) to sync URL → state
  //
  // The handlers (handleSelectChat, etc.) update state directly and use pushState
  // to update the URL without triggering a navigation.

  // Sync URL to state - used for initial load and browser back/forward
  const syncUrlToState = useCallback((isInitialSync: boolean = false) => {
    const currentPath = window.location.pathname

    // Jobs routes
    if (currentPath.startsWith("/jobs")) {
      sidebar.setViewMode("scheduled-jobs")
      if (!isInitialSync) selectChat(null)
      return
    }

    // New chat route
    if (currentPath === "/chat/new") {
      sidebar.setViewMode("chat")
      if (!currentChatId || !isDraftChatId(currentChatId)) {
        startNewChat()
      }
      return
    }

    // Chat route with ID
    const chatMatch = currentPath.match(/^\/chat\/([^/]+)$/)
    if (chatMatch) {
      const urlChatId = chatMatch[1]
      sidebar.setViewMode("chat")
      if (urlChatId !== currentChatId) {
        const chatExists = chats.some(c => c.id === urlChatId) || isDraftChatId(urlChatId)
        if (chatExists) {
          selectChat(urlChatId)
        } else {
          window.history.replaceState(null, "", ROUTES.newChat)
          startNewChat()
        }
      }
      return
    }

    // Home route - redirect to current chat or new chat
    if (currentPath === "/") {
      if (currentChatId) {
        window.history.replaceState(null, "", ROUTES.chat(currentChatId))
      } else {
        window.history.replaceState(null, "", ROUTES.newChat)
        startNewChat()
      }
    }
  }, [currentChatId, chats, isDraftChatId, selectChat, startNewChat, sidebar])

  // Track if we've done initial sync
  const initialSyncDone = useRef(false)

  // Initial sync: on first hydrated render, sync URL to state
  useEffect(() => {
    if (!isHydrated || initialSyncDone.current) return
    initialSyncDone.current = true
    syncUrlToState(true)
  }, [isHydrated, syncUrlToState])

  // Listen for popstate (browser back/forward)
  useEffect(() => {
    if (!isHydrated) return
    const handlePopState = () => syncUrlToState(false)
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [isHydrated, syncUrlToState])

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

    // Case 1: Unauthenticated user - use local draft state
    if (!session && !currentChatId) {
      const resolvedAgent = (draftAgent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
      const resolvedModel = draftModel ?? settings.defaultModel ?? getDefaultModelForAgent(resolvedAgent, credentialFlags)
      return {
        id: unauthDraftIdRef.current,
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
      return {
        id: currentChatId,
        repo: draftChatConfig.repo,
        baseBranch: draftChatConfig.baseBranch,
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

    return null
  }, [isHydrated, session, currentChatId, draftAgent, draftModel, settings.defaultAgent, settings.defaultModel, credentialFlags, isDraftChatId, draftChatConfig])

  // Unified current chat - either a real chat or a draft chat
  const displayCurrentChat = isHydrated ? (currentChat ?? draftChat) : null
  const isDraftMode = !!draftChat
  const isAuthenticatedDraft = isDraftMode && !!session

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
      window.history.pushState(null, "", ROUTES.chat(newChatId))
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
    window.history.pushState(null, "", ROUTES.chat(chatId))
  }, [selectChat, sidebar])

  // Handler for opening scheduled jobs view
  const handleOpenScheduledJobs = useCallback(() => {
    // Update state
    sidebar.setViewMode("scheduled-jobs")
    sidebar.setSelectedScheduledJob(null)
    selectChat(null)
    // Update URL without triggering Next.js navigation
    window.history.pushState(null, "", ROUTES.jobs)
  }, [sidebar, selectChat])

  // Handler for scheduled job selection (memoized to prevent infinite loops)
  const handleJobSelect = useCallback((job: { id: string; name: string } | null) => {
    sidebar.setSelectedScheduledJob(job ? { id: job.id, name: job.name } : null)
  }, [sidebar])

  // Handler for navigating to a job (updates URL)
  const handleNavigateToJob = useCallback((jobId: string | null) => {
    if (jobId) {
      window.history.pushState(null, "", ROUTES.job(jobId))
    } else {
      window.history.pushState(null, "", ROUTES.jobs)
    }
  }, [])

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
    sendMessage(message, agent, model, files, undefined, planMode)
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

    const chatId = await startNewChat(repo, baseBranch, undefined, false, "pending")
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
  const handleBranchChat = useCallback(() => {
    if (!branchForNewChat || currentChat?.repo === NEW_REPOSITORY) return
    if (!session) {
      modals.setSignInModalOpen(true)
      return
    }
    startNewChat(currentChat.repo, branchForNewChat, currentChat.id)
  }, [currentChat, branchForNewChat, startNewChat, session, modals])

  // Branch and send a message to the new chat (Option+Enter)
  // The new chat starts in the background - we stay on the current chat
  const handleBranchWithMessage = useCallback(async (message: string, agent: string, model: string) => {
    if (!branchForNewChat || currentChat?.repo === NEW_REPOSITORY) return
    if (!session) {
      savePendingMessage({ message, agent, model })
      modals.setSignInModalOpen(true)
      return
    }
    // Create new chat in "pending" state without switching to it
    // Note: "pending" allows sendMessage to proceed, while "creating" would block it
    const chatId = await startNewChat(currentChat.repo, branchForNewChat, currentChat.id, false, "pending")
    if (!chatId) return
    // Send message to the new chat (it runs in background)
    sendMessage(message, agent, model, undefined, chatId)
  }, [currentChat, branchForNewChat, startNewChat, sendMessage, session, modals])

  // Branch a queued message to a new chat (removes from queue)
  // The new chat starts in the background - we stay on the current chat
  const handleBranchQueuedMessage = useCallback(async (id: string, message: string, agent?: string, model?: string) => {
    if (!branchForNewChat || currentChat?.repo === NEW_REPOSITORY) return
    if (!session) {
      modals.setSignInModalOpen(true)
      return
    }
    // Remove from queue first
    removeQueuedMessage(id)
    // Create new chat in "pending" state without switching to it
    // Note: "pending" allows sendMessage to proceed, while "creating" would block it
    const chatId = await startNewChat(currentChat.repo, branchForNewChat, currentChat.id, false, "pending")
    if (!chatId) return
    // Send message to the new chat (it runs in background)
    sendMessage(message, agent, model, undefined, chatId)
  }, [currentChat, branchForNewChat, startNewChat, sendMessage, removeQueuedMessage, session, modals])

  const handleDownloadProject = useCallback(async () => {
    if (!currentChat?.sandboxId || isDownloading) return

    setIsDownloading(true)
    try {
      const response = await fetch("/api/sandbox/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: currentChat.sandboxId }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: "Download failed" }))
        throw new Error(error.error || "Download failed")
      }

      // Create download link from blob
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${currentChat.displayName || "project"}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error("[download] Error:", error)
      // Could add a toast/notification here in the future
    } finally {
      setIsDownloading(false)
    }
  }, [currentChat?.sandboxId, currentChat?.displayName, isDownloading])

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
  const treeOrderedChatIds = useMemo(() => {
    // Show empty chats if they have a parentChatId (were branched)
    // Apply the same repo filter as the Sidebar so navigation matches visual order
    const visible = chats.filter((c) => {
      const hasMessages = c.messages.length > 0 || (c.messageCount ?? 0) > 0
      if (!hasMessages && !c.parentChatId) return false
      if (sidebar.repoFilter === ALL_REPOSITORIES) return true
      if (sidebar.repoFilter === NO_REPOSITORY) return c.repo === NEW_REPOSITORY
      return c.repo === sidebar.repoFilter
    })
    visible.sort((a, b) => (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt))
    const visibleIds = new Set(visible.map((c) => c.id))
    const kids = new Map<string, Chat[]>()
    for (const c of visible) {
      const parent = c.parentChatId && visibleIds.has(c.parentChatId) ? c.parentChatId : null
      if (parent) {
        const list = kids.get(parent) ?? []
        list.push(c)
        kids.set(parent, list)
      }
    }
    const roots = visible.filter((c) => !(c.parentChatId && visibleIds.has(c.parentChatId)))
    const out: string[] = []
    const walk = (c: Chat) => {
      out.push(c.id)
      const children = kids.get(c.id) ?? []
      for (const child of children) walk(child)
    }
    for (const r of roots) walk(r)
    return out
  }, [chats, sidebar.repoFilter])

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
    (deletedIds: string[]) => {
      const deletedSet = new Set(deletedIds)
      const remaining = treeOrderedChatIds.filter((id) => !deletedSet.has(id))
      if (remaining.length === 0) return null

      // Find index of first deleted chat in original order
      const firstDeletedIdx = treeOrderedChatIds.findIndex((id) => deletedSet.has(id))

      // Select chat at same index (following chat) or last remaining if beyond bounds
      const targetIdx = Math.min(firstDeletedIdx, remaining.length - 1)
      return remaining[targetIdx] ?? null
    },
    [treeOrderedChatIds]
  )

  // Open the current chat's branch on GitHub (available once the branch is pushed).
  const githubBranchUrl =
    currentChat?.branch && currentChat.sandboxId && currentChat.repo !== NEW_REPOSITORY
      ? `https://github.com/${currentChat.repo}/tree/${currentChat.branch}`
      : null
  const handleOpenInGitHub = useCallback(() => {
    if (githubBranchUrl) window.open(githubBranchUrl, "_blank", "noopener,noreferrer")
  }, [githubBranchUrl])

  // Copy git clone command to clipboard
  const handleCopyCloneCommand = useCallback(() => {
    if (currentChat?.repo && currentChat.repo !== NEW_REPOSITORY) {
      const command = `git clone git@github.com:${currentChat.repo}.git`
      navigator.clipboard.writeText(command)
    }
  }, [currentChat?.repo])

  // Copy git checkout command to clipboard
  const handleCopyCheckoutCommand = useCallback(() => {
    if (currentChat?.branch) {
      const command = `git fetch origin ${currentChat.branch} && git checkout ${currentChat.branch}`
      navigator.clipboard.writeText(command)
    }
  }, [currentChat?.branch])

  // Open the current chat's sandbox in VS Code via an SSH remote link.
  const handleOpenInVSCode = useCallback(async () => {
    const sandboxId = currentChat?.sandboxId
    if (!sandboxId) return
    try {
      const res = await fetch("/api/sandbox/ssh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to open SSH")
      const cmd: string = data.sshCommand
      const userHost = cmd.match(/(\S+@\S+)/)?.[1]
      const port = cmd.match(/-p\s+(\d+)/)?.[1] ?? "22"
      if (!userHost) return
      const host = port !== "22" ? `${userHost}:${port}` : userHost
      window.open(`vscode://vscode-remote/ssh-remote+${host}${PATHS.PROJECT_DIR}`, "_blank")
    } catch (err) {
      console.error("Failed to open in VS Code:", err)
    }
  }, [currentChat?.sandboxId])

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
          const draftUpdates: { agent?: string | null; model?: string | null; repo?: string; baseBranch?: string } = {}
          if (updates.agent !== undefined) draftUpdates.agent = updates.agent
          if (updates.model !== undefined) draftUpdates.model = updates.model
          if (updates.repo !== undefined) draftUpdates.repo = updates.repo
          if (updates.baseBranch !== undefined) draftUpdates.baseBranch = updates.baseBranch
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
      onSignIn={!session ? () => signIn("github") : undefined}
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
          ? () => setSkillsModalOpen(true)
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
                  onJobSelect={handleJobSelect}
                  showList={sidebar.selectedScheduledJob === null && !urlJobId}
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
                  isMobile={isMobile}
                  isLoadingMessages={isLoadingMessages}
                  draft={currentDraft}
                  onDraftChange={handleDraftChange}
                  isSending={isSendingMessage}
                  onOpenPlan={(messageId) => preview.openPreview({ type: "plan", messageId, content: "" })}
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

      <RepoPickerModal
        open={modals.repoCreateOpen}
        onClose={() => modals.setRepoCreateOpen(false)}
        onSelect={handleRepoSelect}
        isMobile={isMobile}
        mode="create"
        suggestedName={currentChat?.displayName ?? null}
      />

        <SettingsModal
          open={modals.settingsOpen}
          onClose={modals.closeSettings}
          settings={settings}
          credentialFlags={credentialFlags}
          onSave={updateSettings}
          highlightKey={modals.settingsHighlightKey}
          defaultSection={modals.settingsDefaultSection}
          isMobile={isMobile}
        />

        <EnvironmentVariablesModal
          open={modals.envVarsModalOpen}
          onClose={() => modals.setEnvVarsModalOpen(false)}
          chatId={displayCurrentChatId || ""}
          repoName={displayCurrentChat?.repo !== NEW_REPOSITORY ? displayCurrentChat?.repo : undefined}
          onSave={handleSaveEnvVars}
          initialChatEnvVars={envVarsChatEnvVars}
          initialRepoEnvVars={envVarsRepoEnvVars}
          isMobile={isMobile}
        />

        {displayCurrentChatId && (
          <McpServersModal
            open={modals.mcpServersModalOpen}
            onClose={() => modals.setMcpServersModalOpen(false)}
            chatId={displayCurrentChatId}
            isDraftChat={isDraftChatId(displayCurrentChatId)}
            onMaterializeDraft={handleMaterializeDraftForMcp}
          />
        )}

      {/* Skills Search Modal */}
      {currentChat?.sandboxId && currentChat.repo !== NEW_REPOSITORY && (
        <SkillSearchView
          open={skillsModalOpen}
          onOpenChange={setSkillsModalOpen}
          chatId={currentChat.id}
          repo={currentChat.repo}
        />
      )}

      {/* Git Dialogs - now use API calls instead of pasting git commands */}
      <MergeDialog
        open={gitDialogs.mergeOpen}
        onClose={() => gitDialogs.setMergeOpen(false)}
        gitDialogs={gitDialogs}
        chat={displayCurrentChat}
        isMobile={isMobile}
      />
      <RebaseDialog
        open={gitDialogs.rebaseOpen}
        onClose={() => gitDialogs.setRebaseOpen(false)}
        gitDialogs={gitDialogs}
        chat={displayCurrentChat}
        isMobile={isMobile}
      />
      <PRDialog
        open={gitDialogs.prOpen}
        onClose={() => gitDialogs.setPROpen(false)}
        gitDialogs={gitDialogs}
        chat={displayCurrentChat}
        isMobile={isMobile}
      />
      <SquashDialog
        open={gitDialogs.squashOpen}
        onClose={() => gitDialogs.setSquashOpen(false)}
        gitDialogs={gitDialogs}
        chat={displayCurrentChat}
        isMobile={isMobile}
      />
      <ForcePushDialog
        open={gitDialogs.forcePushOpen}
        onClose={() => gitDialogs.setForcePushOpen(false)}
        gitDialogs={gitDialogs}
        chat={displayCurrentChat}
        isMobile={isMobile}
      />

      {/* Sign In Modal - shown when user tries to send message without being signed in */}
      <SignInModal
        open={modals.signInModalOpen}
        onClose={() => modals.setSignInModalOpen(false)}
        isMobile={isMobile}
      />

      {/* Re-auth Modal - shown when stored GitHub token has expired or been revoked */}
      <ReAuthModal
        open={githubTokenInvalid}
        onClose={() => {}}
        isMobile={isMobile}
      />

      <HelpModal
        open={modals.helpOpen}
        onClose={() => modals.setHelpOpen(false)}
        isMobile={isMobile}
      />

      {/* Scheduled Job Form */}
      <ScheduledJobForm
        open={modals.scheduledJobFormOpen}
        onClose={() => modals.setScheduledJobFormOpen(false)}
        onSuccess={() => {
          modals.setScheduledJobFormOpen(false)
          setScheduledJobsRefreshKey((k) => k + 1)
        }}
        isMobile={isMobile}
      />

      {/* Mobile Commands Menu */}
      {isMobile && (
        <MobileCommandsMenu
          open={modals.mobileCommandsOpen}
          onClose={() => modals.setMobileCommandsOpen(false)}
          onSlashCommand={handleSlashCommand}
          hasLinkedRepo={!!(currentChat && currentChat.repo !== NEW_REPOSITORY)}
          inConflict={!!(gitDialogs.rebaseConflict?.inRebase || gitDialogs.rebaseConflict?.inMerge)}
        />
      )}

      <ConfirmDialog
        open={modals.deleteConfirmChatId !== null}
        onClose={() => modals.setDeleteConfirmChatId(null)}
        onConfirm={() => {
          if (modals.deleteConfirmChatId) removeChat(modals.deleteConfirmChatId, getNextChatId)
        }}
        title="Delete chat"
        description={
          <>
            Delete{" "}
            <span className="font-medium text-foreground">
              {chats.find((c) => c.id === modals.deleteConfirmChatId)?.displayName || "this chat"}
            </span>
            ? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isMobile={isMobile}
      />

      {/* Mobile Rename Modal */}
      <MobileRenameModal
        open={modals.mobileRenameChat !== null}
        onClose={() => modals.setMobileRenameChat(null)}
        title="Rename Chat"
        initialValue={modals.mobileRenameChat?.name ?? ""}
        onSave={(newName) => {
          if (modals.mobileRenameChat) {
            renameChat(modals.mobileRenameChat.id, newName)
          }
        }}
        placeholder="Chat name"
      />

      {/* Daily Limit Reached Dialog */}
      <LimitReachedDialog
        open={limitReachedState.show}
        onClose={dismissLimitReached}
        onContinueWithOpenCode={retryWithOpenCode}
        onAddApiKey={() => {
          dismissLimitReached()
          modals.openSettings("anthropic")
        }}
        onUpgradeToPro={() => {
          dismissLimitReached()
          window.open("mailto:james@jamesmurdza.com?subject=Upgrade%20to%20Pro", "_blank")
        }}
        resetAt={limitReachedState.resetAt}
        isMobile={isMobile}
      />
    </div>
    </GitProvider>
    </ChatProvider>
    </PaletteProvider>
  )
}
