"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { MobileHeader } from "@/components/MobileHeader"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { PreviewView } from "@/components/PreviewView"
import { AppModals } from "@/components/AppModals"
import { useGitDialogs } from "@/components/modals/git-dialogs"
import { ScheduledJobsView } from "@/components/scheduled-jobs/ScheduledJobsView"
import { EnvironmentsView } from "@/components/environments/EnvironmentsView"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { PaletteProvider, usePalette } from "@/components/search-palette"
import { basename } from "@/lib/format"
import { useChatWithSync } from "@/lib/hooks/useChatWithSync"
import { useMobile } from "@/lib/hooks/useMobile"
import { useGitHubTokenCheck } from "@/lib/hooks/useGitHubTokenCheck"
import { usePreview } from "@/lib/hooks/usePreview"
import { usePageTitle } from "@/lib/hooks/usePageTitle"
import { useUrlSync } from "@/lib/hooks/useUrlSync"
import { useSandboxActions } from "@/lib/hooks/useSandboxActions"
import { useDraftChat } from "@/lib/hooks/useDraftChat"
import { usePendingMessageReplay } from "@/lib/hooks/usePendingMessageReplay"
import { usePaletteProps } from "@/lib/hooks/usePaletteProps"
import { useSendMessage } from "@/lib/hooks/useSendMessage"
import { useTopUpSettle } from "@/lib/hooks/useTopUpSettle"
import { useBranching } from "@/lib/hooks/useBranching"
import { useChatNavigation } from "@/lib/hooks/useChatNavigation"
import { useRepoSelectHandler } from "@/lib/hooks/useRepoSelectHandler"
import { LocalSyncManager } from "@/lib/hooks/useLocalSync"
import { useToastStore } from "@/lib/stores/toast-store"
import {
  ChatProvider,
  ModalProvider,
  useModals,
  GitProvider,
  SidebarProvider,
  useSidebar,
  type ChatContextValue,
  type GitContextValue,
} from "@/lib/contexts"
import { NEW_REPOSITORY, type Message } from "@/lib/types"
import { useReposQuery, useBranchesQuery, useServersQuery } from "@/lib/query"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import { hasPendingMessage } from "@/lib/pending-message"

function ChatPanelWithPalette(props: React.ComponentProps<typeof ChatPanel>) {
  const { openCommand } = usePalette()
  return <ChatPanel {...props} onOpenCommandPalette={openCommand} />
}

function MobileHeaderWithPalette(props: React.ComponentProps<typeof MobileHeader>) {
  const { openCommand } = usePalette()
  return <MobileHeader {...props} onOpenCommandPalette={openCommand} />
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
  const { githubTokenInvalid, dismissReAuthBanner } = useGitHubTokenCheck()
  const modals = useModals()
  const sidebar = useSidebar()

  // Derived route state for page title (uses Next.js pathname for SSR compatibility)
  const isJobsRoute = pathname?.startsWith("/jobs") ?? false
  const isNewChatRoute = pathname === "/chat/new"

  // Environments route state. Unlike jobs (which drives its selected-id state
  // through the sidebar context, updated via pushState handlers and the
  // popstate-driven useUrlSync), environments derives its id straight from the
  // pathname: there's no equivalent name-caching need since EnvironmentsView
  // already has the full EnvironmentDTO list loaded to look the name up from.
  const isEnvironmentsRoute = pathname?.startsWith("/environments") ?? false
  const urlEnvironmentId = isEnvironmentsRoute
    ? (pathname?.split("/")[2] ?? null) || null
    : null

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
    isHydrated,
    isLoading,
    isLoadingMessages,
    deletingChatIds,
    unseenChatIds,
    startNewChat,
    selectChat,
    removeChat,
    setChatArchived,
    setChatPinned,
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
    reloadChat,
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

  // Use TanStack Query for server polling
  const serversQuery = useServersQuery(
    currentChat?.sandboxId,
    currentChat?.previewUrlPattern
  )
  const availableServers = serversQuery.data ?? []

  // Preview state from hook — also handles auto-opening the first new server
  // that appears in the current sandbox.
  const preview = usePreview({
    currentChat,
    updateCurrentChat,
    availableServers,
  })

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

  // Handler for adding messages to current chat
  const handleAddMessage = useCallback((message: Message) => {
    if (currentChatId) {
      addMessage(currentChatId, message)
    }
  }, [currentChatId, addMessage])

  // Git dialogs state — the hook does its own target-chat lookups internally
  // (finding the chat that owns a branch in this repo) given `chats` and
  // `updateChatById`, and subscribes to SSE conflict updates via
  // setOnConflictStateChange so the warning icon refreshes live. Backend
  // creates messages directly in DB; refetchMessages pulls them down.
  const gitDialogs = useGitDialogs({
    chat: currentChat ?? null,
    chats,
    updateChatById,
    refetchMessages,
    setOnConflictStateChange,
  })

  // Close mobile sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      sidebar.setMobileSidebarOpen(false)
    }
  }, [isMobile, sidebar])

  // Set once on landing back from a successful Stripe checkout; see below.
  const [settlingTopUp, setSettlingTopUp] = useState(false)
  useTopUpSettle(settlingTopUp)

  // Stripe's Checkout success/cancel URLs redirect back to "/" with a `topup`
  // query param. Surface it as a toast, jump to the Credits tab on success so
  // the user lands where the (webhook-credited, so not instant) balance shows
  // up, then scrub the param so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const topup = params.get("topup")
    if (!topup) return

    if (topup === "success") {
      useToastStore.getState().addToast({
        title: "Payment received",
        body: "Your credits will show up in a few seconds.",
      })
      modals.openSettingsSection("credits")
      // The webhook credits the balance out of band from this redirect, so the
      // settings query this page just mounted with predates the payment. Poll
      // it briefly (see useTopUpSettle) rather than leaving a red dot over
      // credits the user has already bought.
      setSettlingTopUp(true)
    } else if (topup === "cancelled") {
      useToastStore.getState().addToast({ title: "Checkout cancelled" })
    }

    params.delete("topup")
    params.delete("session_id")
    const query = params.toString()
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
    // Meant to run once, right after landing back from Stripe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    selectChat,
    startNewChat,
    startAgentDraft: (agent) =>
      startNewChat(NEW_REPOSITORY, "main", undefined, true, "pending", agent),
    setViewMode: sidebar.setViewMode,
    setSelectedScheduledJob: sidebar.setSelectedScheduledJob,
  })

  // =============================================================================
  // Draft Chat & Display Chat
  // =============================================================================
  // For users without a real chat (either unauthenticated or authenticated with
  // a draft chat ID), useDraftChat synthesizes a "draft" chat so the UI is
  // interactive. It also owns the draft-input state, the agent/model routing
  // for unauth/auth drafts, and the optimistic-message bookkeeping shown the
  // instant a draft is sent.
  const {
    displayCurrentChat,
    isDraftMode,
    handleUpdateChatProp,
    currentDraft,
    handleDraftChange,
    setOptimisticDraft,
    handleMaterializeDraftForMcp,
  } = useDraftChat({
    isHydrated,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
    draftChatConfig,
    isDraftChatId,
    updateDraftChatConfig,
    updateCurrentChat,
    materializeDraft,
    drafts,
    updateDraft,
  })

  // Chat/job navigation: view-switching handlers, keyboard traversal,
  // merge/rebase requests, and the URL-reconciliation effects (draft promotion,
  // stale-chat redirect).
  const {
    handleNewChat,
    handleSelectChat,
    handleRepoFilterChange,
    handleOpenScheduledJobs,
    handleNavigateToJob,
    handleNavigateChat,
    handleRequestMergeChats,
    handleRequestRebaseChat,
    getNextChatId,
  } = useChatNavigation({
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
  })

  // Repo selection for the current chat (+ the transient setup-remote error toast).
  const { errorBanner, handleRepoSelect } = useRepoSelectHandler({
    displayCurrentChat,
    isDraftMode,
    updateDraftChatConfig,
    updateChatRepo,
  })

  // Dynamic page title based on current view
  const pageTitle = useMemo(() => {
    if (isEnvironmentsRoute) {
      return "Environments"
    }
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
  }, [
    isEnvironmentsRoute,
    isJobsRoute,
    isNewChatRoute,
    isDraftMode,
    displayCurrentChat?.displayName,
    sidebar.selectedScheduledJob?.name,
  ])

  // Keep sidebar.viewMode following the URL when a hard load or browser
  // navigation lands directly on /environments (or a specific environment).
  // Every other viewMode transition already goes through an explicit handler
  // (handleSelectChat, handleOpenScheduledJobs, useUrlSync's popstate sync);
  // environments isn't wired into that popstate-driven route table, so this
  // effect is the one path that keeps it in sync with the URL.
  useEffect(() => {
    if (isEnvironmentsRoute) sidebar.setViewMode("environments")
  }, [isEnvironmentsRoute, sidebar])

  usePageTitle(pageTitle)

  // Sidebar entry point for the environments list. Mirrors
  // useChatNavigation's handleOpenScheduledJobs: switch view mode, drop any
  // selected chat/job, and push the URL without a Next.js navigation (so the
  // page doesn't remount).
  const handleOpenEnvironments = useCallback(() => {
    sidebar.setViewMode("environments")
    sidebar.setSelectedScheduledJob(null)
    selectChat(null)
    window.history.pushState(null, "", "/environments")
  }, [sidebar, selectChat])

  // "User clicked send" flow — owns handleSendMessage and the isSendingMessage
  // flag (with its auto-reset effects).
  const { handleSendMessage, isSendingMessage } = useSendMessage({
    sidebar,
    displayCurrentChat,
    currentChatId,
    isDraftMode,
    sendMessage,
    setOptimisticDraft,
    openSignInModal: modals.setSignInModalOpen,
  })

  // =============================================================================
  // Handlers
  // =============================================================================

  // Handler for the Create Repository palette/slash command.
  const handleCreateRepo = () => {
    if (!session) {
      modals.setSignInModalOpen(true)
      return
    }
    modals.setRepoCreateOpen(true)
  }

  // After sign-in, replay any pending message saved before the OAuth redirect.
  // The hook handles the two-effect coordination (create chat → stage send →
  // send once the chat appears in `chats`) and the once-per-session guard.
  usePendingMessageReplay({
    isHydrated,
    chats,
    currentChatId,
    startNewChat,
    sendMessage,
    updateChatById,
    onReplayBegin: () => modals.setSignInModalOpen(false),
  })

  // "Branch this chat" family — owns canBranch + the three branch handlers
  // (bare / with-message / from-queue). All flow through one shared helper.
  const {
    canBranch,
    handleBranchChat,
    handleBranchFromChat,
    handleBranchWithMessage,
    handleBranchQueuedMessage,
  } = useBranching({
    currentChat,
    chats,
    startNewChat,
    sendMessage,
    removeQueuedMessage,
    openSignInModal: modals.setSignInModalOpen,
  })

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

  // Don't render chats until hydrated to avoid SSR mismatch
  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null

  // Props shared by the desktop split-pane and mobile full-screen PreviewView.
  // Only style/className differ between the two layouts.
  const previewCommonProps = {
    item: preview.previewItem,
    sandboxId: currentChat?.sandboxId ?? null,
    repo: currentChat?.repo && currentChat.repo !== NEW_REPOSITORY ? currentChat.repo : null,
    branch: currentChat?.branch ?? currentChat?.baseBranch ?? null,
    onClose: preview.closePreview,
    allItems: preview.previewItems,
    onSelectItem: preview.selectPreviewItem,
    onCloseItem: preview.closePreviewItem,
    messages: currentChat?.messages,
  }

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

  // Assemble the (large) PaletteProvider props object — see usePaletteProps
  // for the conditional-action wiring (terminal open/toggle, sign-in/out,
  // git-command gating, etc.).
  const paletteProps = usePaletteProps({
    isMobile,
    repos,
    branches,
    displayChats,
    displayCurrentChatId,
    currentChat,
    availableServers,
    canBranch,
    githubBranchUrl,
    isDownloading,
    handleOpenInGitHub,
    handleOpenInVSCode,
    handleDownloadProject,
    handleCopyCloneCommand,
    handleCopyCheckoutCommand,
    handleOpenEnvVars,
    handleArchiveChat: (chatId) => setChatArchived(chatId, true, getNextChatId),
    handlePaletteSelectRepo,
    handlePaletteSelectBranch,
    handleRepoFilterChange,
    handleRunCommand,
    handleNewChat,
    handleBranchChat,
    handleCreateRepo,
    handleNavigateChat,
    handleSelectChat,
    modals,
    sidebar,
    preview,
    onToggleSkillsModal: () => setSkillsModalOpen((prev) => !prev),
  })

  return (
    <PaletteProvider {...paletteProps}>
    <ChatProvider value={chatContextValue}>
    <GitProvider value={gitContextValue}>
    <LocalSyncManager />
    <div className={`flex overflow-hidden ${isMobile ? 'h-screen-mobile' : 'h-screen'}`}>
      {/* Sidebar — desktop renders inline, mobile renders as a drawer.
          The Sidebar component branches on isMobile internally, so the only
          props that actually differ are the collapse/width controls (no-op on
          mobile), the drawer-specific mobileOpen/onMobileClose, and the
          scheduled-jobs handler (which also closes the drawer on mobile). */}
      <Sidebar
        chats={displayChats}
        currentChatId={displayCurrentChatId}
        deletingChatIds={deletingChatIds}
        unseenChatIds={unseenChatIds}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onDeleteChat={(chatId) => {
          // Always confirm deletions triggered from the sidebar "..." menu.
          modals.setDeleteConfirmChatId(chatId)
        }}
        onPinChat={(chatId, pinned) => setChatPinned(chatId, pinned)}
        onBranchChat={handleBranchFromChat}
        onArchiveChat={(chatId) => setChatArchived(chatId, true, getNextChatId)}
        onUnarchiveChat={(chatId) => setChatArchived(chatId, false, getNextChatId)}
        onRenameChat={renameChat}
        isMobile={isMobile}
        collapsed={isMobile ? false : sidebar.collapsed}
        onToggleCollapse={isMobile ? () => {} : () => sidebar.toggleCollapse()}
        width={isMobile ? 280 : sidebar.width}
        onWidthChange={isMobile ? () => {} : sidebar.setWidth}
        mobileOpen={isMobile ? sidebar.mobileSidebarOpen : undefined}
        onMobileClose={isMobile ? () => sidebar.setMobileSidebarOpen(false) : undefined}
        repoFilter={sidebar.repoFilter}
        onRepoFilterChange={handleRepoFilterChange}
        collapsedChatIds={sidebar.collapsedChatIds}
        onToggleChatCollapsed={sidebar.toggleChatCollapsed}
        onRequestMergeChats={handleRequestMergeChats}
        onRequestRebaseChat={handleRequestRebaseChat}
        onOpenScheduledJobs={
          isMobile
            ? () => {
                handleOpenScheduledJobs()
                sidebar.setMobileSidebarOpen(false)
              }
            : handleOpenScheduledJobs
        }
        scheduledJobsActive={sidebar.viewMode === "scheduled-jobs"}
        selectedScheduledJob={sidebar.viewMode === "scheduled-jobs" ? sidebar.selectedScheduledJob : null}
        onOpenEnvironments={
          isMobile
            ? () => {
                handleOpenEnvironments()
                sidebar.setMobileSidebarOpen(false)
              }
            : handleOpenEnvironments
        }
        environmentsActive={sidebar.viewMode === "environments"}
        isLoadingChats={!isHydrated || (isLoading && displayChats.length === 0)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        {isMobile && (
          <MobileHeaderWithPalette
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
              {sidebar.viewMode === "environments" ? (
                <EnvironmentsView
                  urlEnvironmentId={urlEnvironmentId}
                  onNavigate={(id) => {
                    window.history.pushState(null, "", id ? `/environments/${id}` : "/environments")
                  }}
                />
              ) : sidebar.viewMode === "scheduled-jobs" ? (
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
                    setLimitReachedState({ show: true, provider: "claude" })
                  }}
                  onSendMessage={handleSendMessage}
                  onReload={reloadChat}
                  onEnqueueMessage={enqueueMessage}
                  onRemoveQueuedMessage={removeQueuedMessage}
                  onResumeQueue={resumeQueue}
                  onStopAgent={stopAgent}
                  onUpdateChat={handleUpdateChatProp}
                  onSlashCommand={handleSlashCommand}
                  onOpenFile={(filePath) => {
                    const filename = basename(filePath)
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
                  {...previewCommonProps}
                />
              </>
            )}
          </div>
      </div>

      {/* Mobile preview - full-screen overlay since there's no room for a split pane. */}
      {isMobile && preview.previewOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-card pt-safe">
          <PreviewView
            className="flex-1 min-h-0"
            {...previewCommonProps}
          />
        </div>
      )}

      {/* Transparent full-screen shield during split drag so the cursor isn't
          swallowed by iframes or other child elements. */}
      {preview.isResizingPreview && (
        <div className="fixed inset-0 z-[999] cursor-col-resize" />
      )}

      {/* Transient error toast — auto-dismisses 5s after errorBanner is set. */}
      {errorBanner && (
        <div
          role="alert"
          className="fixed top-4 right-4 z-[1000] max-w-md bg-destructive text-destructive-foreground px-4 py-3 rounded-md shadow-lg text-sm animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {errorBanner}
        </div>
      )}

      <AppModals
        isMobile={isMobile}
        githubTokenInvalid={githubTokenInvalid}
        onDismissReAuthBanner={dismissReAuthBanner}
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
