"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { RepoSidebar } from "@/components/sidebar/repo-sidebar"
import { BranchList } from "@/components/sidebar/branch-list"
import { ContentPanel } from "@/components/panels/content-panel"
import { ChatPanel, EmptyChatPanel } from "@/components/panels/chat-panel"
import { GitHistoryPanel } from "@/components/panels/git-history-panel"
import { GitHistorySheet } from "@/components/panels/git-history-sheet"
import { SettingsModal } from "@/components/modals/settings-modal"
import { RepoSettingsModal } from "@/components/modals/repo-settings-modal"
import { AddRepoModal } from "@/components/modals/add-repo-modal"
import { MobileHeader } from "@/components/layout/mobile-header"
import { MobileSidebarDrawer } from "@/components/sidebar/mobile-sidebar-drawer"
import { DiffModal } from "@/components/modals/diff-modal"
import { GitDialogs, useGitDialogs } from "@/components/git"
import { BRANCH_STATUS } from "@/lib/shared/constants"
import { cn } from "@/lib/shared/utils"
import { Loader2 } from "lucide-react"

// Import hooks
import {
  useRepoData,
  useBranchSelection,
  useRepoOperations,
  useBranchOperations,
  useMobileHandlers,
  useSyncData,
  useCrossDeviceSync,
  useIsMobile,
  useRepoNavigation,
  useExecutionManager,
} from "@/hooks"

// Import Zustand stores
import { useUIStore, useRepoStore } from "@/lib/stores"
import { useExecutionStore, recoverActiveExecutions } from "@/lib/stores/execution-store"
import type { Branch } from "@/lib/shared/types"

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const isMobile = useIsMobile()
  const { repoFromUrl, branchFromUrl, updateUrlToRepo, updateUrlToRepoBranch } = useRepoNavigation()

  // Rehydrate persisted UI state after mount to avoid SSR hydration mismatches
  useEffect(() => {
    useUIStore.persist.rehydrate()
  }, [])

  // Zustand UI state
  const {
    settingsOpen,
    settingsHighlightField,
    openSettings,
    closeSettings,
    clearSettingsHighlight,
    addRepoOpen,
    openAddRepo,
    closeAddRepo,
    repoSettingsOpen,
    openRepoSettings,
    closeRepoSettings,
    repoEnvVars,
    setRepoEnvVars,
    gitHistoryOpen,
    toggleGitHistory,
    closeGitHistory,
    gitHistoryRefreshTrigger,
    triggerGitHistoryRefresh,
    pendingStartCommit,
    setPendingStartCommit,
    clearPendingStartCommit,
    desktopRebaseConflict,
    setDesktopRebaseConflict,
    pendingRepoFromUrl,
    setPendingRepoFromUrl,
    clearPendingRepoFromUrl,
  } = useUIStore()

  // Get resetRepoState for logout
  const resetRepoState = useRepoStore((state) => state.resetRepoState)

  // Core data state
  const {
    repos,
    setRepos,
    quota,
    credentials,
    isAdmin,
    userId,
    loaded,
    messagesLoadingBranchIds,
    refresh,
    refreshQuotaOnly,
    loadBranchMessages,
  } = useRepoData({ isAuthenticated: status === "authenticated" })

  // Callback when branch from URL is not found - update URL to remove branch
  const handleBranchNotFound = useCallback(() => {
    if (repoFromUrl) {
      updateUrlToRepo(repoFromUrl.owner, repoFromUrl.name)
    }
  }, [repoFromUrl, updateUrlToRepo])

  // Selection state
  const {
    activeRepoId,
    activeBranchId,
    activeBranchIdRef,
    activeRepo,
    activeBranch,
    selectRepo: selectRepoInternal,
    selectBranch: selectBranchInternal,
    setActiveBranchId,
  } = useBranchSelection({ repos, loaded, repoFromUrl, branchFromUrl, onBranchNotFound: handleBranchNotFound })

  // Wrap selectRepo to also update URL (without triggering page reload)
  const selectRepo = useCallback(
    (repoId: string) => {
      const repo = repos.find((r) => r.id === repoId)
      if (repo) {
        // When selecting a repo, update URL with first branch if available
        const firstBranch = repo.branches[0]
        if (firstBranch) {
          updateUrlToRepoBranch(repo.owner, repo.name, firstBranch.name)
        } else {
          updateUrlToRepo(repo.owner, repo.name)
        }
      }
      selectRepoInternal(repoId)
    },
    [repos, updateUrlToRepo, updateUrlToRepoBranch, selectRepoInternal]
  )

  // Wrap selectBranch to also update URL with branch name
  const selectBranch = useCallback(
    (branchId: string) => {
      const branch = activeRepo?.branches.find((b) => b.id === branchId)
      if (activeRepo && branch) {
        updateUrlToRepoBranch(activeRepo.owner, activeRepo.name, branch.name)
      }
      selectBranchInternal(branchId)
    },
    [activeRepo, updateUrlToRepoBranch, selectBranchInternal]
  )

  // Repo operations
  const {
    handleAddRepo,
    handleRemoveRepo,
    handleReorderRepos,
    handleAddBranch,
    handleRemoveBranch,
  } = useRepoOperations({
    repos,
    setRepos,
    activeRepoId,
    activeRepo,
    selectRepo,
    setActiveBranchId,
  })

  // Branch operations
  const {
    handleUpdateBranch,
    handleSaveDraftForBranch,
    handleAddMessage,
    handleUpdateMessage,
  } = useBranchOperations({
    repos,
    setRepos,
    activeRepo,
    activeBranchIdRef,
    setActiveBranchId,
  })

  const getBranchById = useCallback(
    (branchId: string): Branch | undefined =>
      repos.flatMap((r) => r.branches).find((b) => b.id === branchId),
    [repos]
  )

  const executionRefreshGitRef = useRef<(() => void) | null>(null)

  useExecutionManager({
    onUpdateMessage: handleUpdateMessage,
    onUpdateBranch: handleUpdateBranch,
    onAddMessage: handleAddMessage,
    onForceSave: () => {},
    onCommitsDetected: triggerGitHistoryRefresh,
    onRefreshGitConflictState: () => executionRefreshGitRef.current?.(),
  })

  useEffect(() => {
    useExecutionStore.getState().setActiveBranchId(activeBranchId)
  }, [activeBranchId])

  useEffect(() => {
    if (!loaded || status !== "authenticated") return
    void recoverActiveExecutions()
  }, [loaded, status])

  const switchAwayFromBranchBeforeDelete = useCallback(
    (branchId: string) => {
      if (activeBranchId !== branchId) return
      const remaining = activeRepo?.branches.filter((b) => b.id !== branchId) ?? []
      const next = remaining[0]?.id
      if (next) {
        handleUpdateBranch(next, { unread: false })
        selectBranch(next)
      } else {
        setActiveBranchId(null)
      }
    },
    [activeBranchId, activeRepo, handleUpdateBranch, selectBranch, setActiveBranchId]
  )

  // Streaming state ref - signals when a message is actively being streamed
  // This is used to prevent sync from overwriting streaming content
  const streamingMessageIdRef = useRef<string | null>(null)

  // Mobile UI state from Zustand
  const {
    mobileSidebarOpen,
    setMobileSidebarOpen,
    mobileSandboxToggleLoading,
    setMobileSandboxToggleLoading,
    mobilePrLoading,
    setMobilePrLoading,
    mobileDiffOpen,
    closeMobileDiff,
    openMobileDiff,
  } = useUIStore()

  // Mobile handlers
  const { handleMobileSandboxToggle, handleMobileCreatePR } = useMobileHandlers({
    activeBranch,
    activeRepo,
    handleUpdateBranch,
    mobileSandboxToggleLoading,
    setMobileSandboxToggleLoading,
    mobilePrLoading,
    setMobilePrLoading,
  })

  // Mobile git dialogs (merge, rebase, tag) - uses shared hook
  const mobileGitDialogs = useGitDialogs({
    branch: activeBranch!,
    repoName: activeRepo?.name || "",
    repoOwner: activeRepo?.owner || "",
    repoFullName: activeRepo ? `${activeRepo.owner}/${activeRepo.name}` : "",
    onAddMessage: handleAddMessage,
    onUpdateMessage: handleUpdateMessage,
    defaultSquashOnMerge: credentials?.squashOnMerge ?? false,
  })

  // Cross-device sync
  const { handleSyncData } = useSyncData({ setRepos, activeBranchIdRef, streamingMessageIdRef })
  useCrossDeviceSync({
    enabled: loaded,
    interval: 5000,
    onSyncData: handleSyncData,
  })

  // Local UI state (kept local as it's not needed elsewhere)
  const [branchListWidth, setBranchListWidth] = useState(260)
  const [branchListCollapsed, setBranchListCollapsed] = useState(false)
  const [branchListWidthBeforeCollapse, setBranchListWidthBeforeCollapse] = useState(260)

  // Handler to toggle branch list collapse/expand
  const handleToggleBranchListCollapse = useCallback(() => {
    if (branchListCollapsed) {
      // Expand: restore previous width
      setBranchListWidth(branchListWidthBeforeCollapse)
      setBranchListCollapsed(false)
    } else {
      // Collapse: save current width and set to minimum
      setBranchListWidthBeforeCollapse(branchListWidth)
      setBranchListWidth(0)
      setBranchListCollapsed(true)
    }
  }, [branchListCollapsed, branchListWidth, branchListWidthBeforeCollapse])

  // Handler to open settings with a specific field highlighted
  const handleOpenSettingsWithHighlight = useCallback((field: string) => {
    openSettings(field)
  }, [openSettings])

  // Handler to close settings and clear highlight
  const handleSettingsClose = useCallback(() => {
    closeSettings()
  }, [closeSettings])

  // Handler to open repo settings
  const handleOpenRepoSettings = useCallback(async () => {
    if (!activeRepoId) return
    // Fetch env var keys for the repo
    try {
      const res = await fetch(`/api/repo/${activeRepoId}/env-vars`)
      if (res.ok) {
        const data = await res.json()
        setRepoEnvVars(data.envVars || {})
      } else {
        setRepoEnvVars({})
      }
    } catch {
      setRepoEnvVars({})
    }
    openRepoSettings()
  }, [activeRepoId, setRepoEnvVars, openRepoSettings])

  // Handler to close repo settings
  const handleRepoSettingsClose = useCallback(() => {
    closeRepoSettings()
  }, [closeRepoSettings])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  // Update URL when landing on root page with no repo in URL
  useEffect(() => {
    if (!loaded || !activeRepo) return
    if (!repoFromUrl) {
      if (activeBranch) {
        updateUrlToRepoBranch(activeRepo.owner, activeRepo.name, activeBranch.name)
      } else {
        updateUrlToRepo(activeRepo.owner, activeRepo.name)
      }
    }
  }, [loaded, activeRepo, activeBranch, repoFromUrl, updateUrlToRepo, updateUrlToRepoBranch])

  // Handle URL repo that is not found in user's repos - open AddRepoModal with pre-filled URL
  useEffect(() => {
    if (!loaded || !repoFromUrl) return

    const matchingRepo = repos.find(
      (r) =>
        r.owner.toLowerCase() === repoFromUrl.owner.toLowerCase() &&
        r.name.toLowerCase() === repoFromUrl.name.toLowerCase()
    )

    if (!matchingRepo) {
      // URL repo not found in user's repos - set pending and open modal to add/fork
      setPendingRepoFromUrl({ owner: repoFromUrl.owner, name: repoFromUrl.name })
      openAddRepo()
    } else {
      // Repo found, clear any pending
      clearPendingRepoFromUrl()
    }
  }, [loaded, repos, repoFromUrl, setPendingRepoFromUrl, clearPendingRepoFromUrl, openAddRepo])

  // Load messages when active branch changes
  useEffect(() => {
    if (activeBranchId && activeRepoId) {
      loadBranchMessages(activeBranchId, activeRepoId)
    }
  }, [activeBranchId, activeRepoId, loadBranchMessages])

  useEffect(() => {
    if (!activeBranch) setDesktopRebaseConflict(false)
  }, [activeBranch, setDesktopRebaseConflict])

  // Dynamic page title with org/repo and notification counts
  useEffect(() => {
    const allBranches = repos.flatMap((r) => r.branches)
    const running = allBranches.filter((b) => b.status === BRANCH_STATUS.RUNNING).length
    const unread = allBranches.filter((b) => b.unread).length
    const totalNotifications = running + unread

    const repoPrefix = activeRepo ? `${activeRepo.owner}/${activeRepo.name}` : null

    if (repoPrefix) {
      if (totalNotifications > 0) {
        document.title = `${repoPrefix} (${totalNotifications}) – Upstream Agents`
      } else {
        document.title = `${repoPrefix} – Upstream Agents`
      }
    } else {
      document.title = "Upstream Agents"
    }
  }, [repos, activeRepo])

  // Loading state
  if (status === "loading" || !loaded) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </main>
    )
  }

  // Not authenticated - will redirect
  if (status === "unauthenticated") {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Redirecting to login...</div>
      </main>
    )
  }

  return (
    <>
      <main className="flex h-dvh overflow-hidden">
        {/* Repo Sidebar - desktop only */}
        {!isMobile && (
          <RepoSidebar
            repos={repos}
            activeRepoId={activeRepoId}
            userAvatar={session?.user?.image || null}
            userName={session?.user?.name || null}
            userLogin={session?.user?.githubLogin || null}
            onSelectRepo={selectRepo}
            onRemoveRepo={handleRemoveRepo}
            onReorderRepos={handleReorderRepos}
            onOpenSettings={() => openSettings()}
            onOpenAddRepo={openAddRepo}
            onSignOut={() => { resetRepoState(); signOut({ callbackUrl: "/login" }) }}
            quota={quota}
            isAdmin={isAdmin}
          />
        )}

        {/* Mobile Sidebar Drawer */}
        {isMobile && (
          <MobileSidebarDrawer
            open={mobileSidebarOpen}
            onOpenChange={setMobileSidebarOpen}
            repos={repos}
            activeRepoId={activeRepoId}
            activeBranchId={activeBranchId}
            userAvatar={session?.user?.image || null}
            userName={session?.user?.name || null}
            userLogin={session?.user?.githubLogin || null}
            onSelectRepo={selectRepo}
            onSelectBranch={(branchId) => {
                handleUpdateBranch(branchId, { unread: false })
                selectBranch(branchId)
              }}
            onRemoveRepo={handleRemoveRepo}
            onOpenSettings={() => openSettings()}
            onOpenAddRepo={openAddRepo}
            onSignOut={() => { resetRepoState(); signOut({ callbackUrl: "/login" }) }}
            quota={quota}
            onAddBranch={handleAddBranch}
            onUpdateBranch={handleUpdateBranch}
            onQuotaRefresh={refreshQuotaOnly}
            credentials={credentials}
            onRemoveBranch={(branchId, deleteRemote) => handleRemoveBranch(branchId, deleteRemote, activeBranchId ?? undefined)}
            onSwitchAwayFromBranchBeforeDelete={switchAwayFromBranchBeforeDelete}
          />
        )}

        {/* Desktop: Branch List (always visible) */}
        {!isMobile && (
          <div className="flex">
          {activeRepo ? (
            <BranchList
              repo={activeRepo}
              activeBranchId={activeBranchId}
              onSelectBranch={(branchId) => {
                handleUpdateBranch(branchId, { unread: false })
                selectBranch(branchId)
              }}
              onAddBranch={handleAddBranch}
              onRemoveBranch={(branchId, deleteRemote) => handleRemoveBranch(branchId, deleteRemote, activeBranchId ?? undefined)}
              onSwitchAwayFromBranchBeforeDelete={switchAwayFromBranchBeforeDelete}
              onUpdateBranch={handleUpdateBranch}
              onQuotaRefresh={refreshQuotaOnly}
              width={branchListWidth}
              onWidthChange={setBranchListWidth}
              collapsed={branchListCollapsed}
              onToggleCollapse={handleToggleBranchListCollapse}
              pendingStartCommit={pendingStartCommit}
              onClearPendingCommit={clearPendingStartCommit}
              quota={quota}
              credentials={credentials}
              onOpenRepoSettings={handleOpenRepoSettings}
            />
          ) : (
            <div
              className="flex h-full shrink-0 flex-col items-center justify-center border-r border-border bg-card text-muted-foreground"
              style={{ width: branchListWidth }}
            >
              <p className="text-xs">Add a repository to get started</p>
            </div>
          )}
        </div>
        )}

        {/* Mobile: Header + Chat (Slack-like layout) */}
        {isMobile && (
          <div
            className={cn(
              "flex flex-1 flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden",
              activeBranch &&
                (mobileGitDialogs.rebaseConflict?.inRebase ||
                  mobileGitDialogs.rebaseConflict?.inMerge) &&
                "border border-red-700 dark:border-red-600"
            )}
          >
            {/* Mobile Header with hamburger and actions */}
            <MobileHeader
              repoOwner={activeRepo?.owner || null}
              repoName={activeRepo?.name || null}
              branch={activeBranch}
              onOpenSidebar={() => setMobileSidebarOpen(true)}
              onToggleGitHistory={toggleGitHistory}
              onOpenDiff={openMobileDiff}
              onCreatePR={handleMobileCreatePR}
              onSandboxToggle={handleMobileSandboxToggle}
              onMerge={() => mobileGitDialogs.setMergeOpen(true)}
              onRebase={() => mobileGitDialogs.setRebaseOpen(true)}
              gitHistoryOpen={gitHistoryOpen}
              sandboxToggleLoading={mobileSandboxToggleLoading}
              prLoading={mobilePrLoading}
              onUpdateBranch={handleUpdateBranch}
              credentials={credentials}
              rebaseConflict={mobileGitDialogs.rebaseConflict}
              onAbortConflict={mobileGitDialogs.handleAbortConflict}
              abortLoading={mobileGitDialogs.actionLoading}
            />

            {/* Chat content */}
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
              {activeBranch && activeRepo ? (
                <ChatPanel
                  branch={activeBranch}
                  repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
                  repoName={activeRepo.name}
                  repoOwner={activeRepo.owner}
                  gitHistoryOpen={gitHistoryOpen}
                  onToggleGitHistory={toggleGitHistory}
                  onAddMessage={handleAddMessage}
                  onUpdateMessage={handleUpdateMessage}
                  onUpdateBranch={handleUpdateBranch}
                  onSaveDraftForBranch={handleSaveDraftForBranch}
                  onForceSave={() => {}}
                  onCommitsDetected={triggerGitHistoryRefresh}
                  onBranchFromCommit={setPendingStartCommit}
                  messagesLoading={messagesLoadingBranchIds.has(activeBranch.id)}
                  isMobile={true}
                  streamingMessageIdRef={streamingMessageIdRef}
                  credentials={credentials}
                  onOpenSettings={() => openSettings()}
                  onOpenSettingsWithHighlight={handleOpenSettingsWithHighlight}
                  getBranchById={getBranchById}
                  executionRefreshGitRef={executionRefreshGitRef}
                />
              ) : (
                <EmptyChatPanel hasRepos={repos.length > 0} />
              )}
            </div>
          </div>
        )}

        {/* Mobile Git History Sheet */}
        {isMobile && activeBranch?.sandboxId && activeRepo && (
          <GitHistorySheet
            open={gitHistoryOpen}
            onOpenChange={(open) => open ? null : closeGitHistory()}
            sandboxId={activeBranch.sandboxId}
            repoName={activeRepo.name}
            baseBranch={activeBranch.baseBranch}
            refreshTrigger={gitHistoryRefreshTrigger}
            onScrollToCommit={(shortHash) => {
              document.getElementById(`commit-${shortHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
            onBranchFromCommit={setPendingStartCommit}
          />
        )}

        {/* Desktop: Main content area (branch list is outside this wrapper) */}
        {!isMobile && (
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1",
            desktopRebaseConflict && "border border-red-700 dark:border-red-600"
          )}
        >
          {activeBranch && activeRepo ? (
            <ChatPanel
              branch={activeBranch}
              repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
              repoName={activeRepo.name}
              repoOwner={activeRepo.owner}
              gitHistoryOpen={gitHistoryOpen}
              onToggleGitHistory={toggleGitHistory}
              onAddMessage={handleAddMessage}
              onUpdateMessage={handleUpdateMessage}
              onUpdateBranch={handleUpdateBranch}
              onSaveDraftForBranch={handleSaveDraftForBranch}
              onForceSave={() => {}}
              onCommitsDetected={triggerGitHistoryRefresh}
              onBranchFromCommit={setPendingStartCommit}
              messagesLoading={messagesLoadingBranchIds.has(activeBranch.id)}
              streamingMessageIdRef={streamingMessageIdRef}
              credentials={credentials}
              onOpenSettings={() => openSettings()}
              onOpenSettingsWithHighlight={handleOpenSettingsWithHighlight}
              onRebaseConflictChange={setDesktopRebaseConflict}
              getBranchById={getBranchById}
              executionRefreshGitRef={executionRefreshGitRef}
            />
          ) : (
            <EmptyChatPanel hasRepos={repos.length > 0} />
          )}

          {gitHistoryOpen && activeBranch?.sandboxId && activeRepo && (
            <GitHistoryPanel
              sandboxId={activeBranch.sandboxId}
              repoName={activeRepo.name}
              baseBranch={activeBranch.baseBranch}
              onClose={closeGitHistory}
              refreshTrigger={gitHistoryRefreshTrigger}
              onScrollToCommit={(shortHash) => {
                document.getElementById(`commit-${shortHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
              }}
              onBranchFromCommit={setPendingStartCommit}
            />
          )}

          {/* Content Panel - shows file tabs, terminals, and server previews */}
          {activeBranch?.sandboxId && activeRepo && (
            <ContentPanel
              sandboxId={activeBranch.sandboxId}
              repoPath={`/home/daytona/${activeRepo.name}`}
              cacheKey={`${activeRepo.id}-${activeBranch.id}`}
              previewUrlPattern={activeBranch.previewUrlPattern}
            />
          )}
        </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={handleSettingsClose}
        credentials={credentials}
        onCredentialsUpdate={refresh}
        highlightField={settingsHighlightField}
        onClearHighlight={clearSettingsHighlight}
      />
      <AddRepoModal
        open={addRepoOpen}
        onClose={() => {
          closeAddRepo()
          // If user cancels adding a repo from URL, clear pending and go home
          if (pendingRepoFromUrl) {
            clearPendingRepoFromUrl()
            router.replace("/")
          }
        }}
        githubUser={session?.user?.githubLogin || null}
        existingRepos={repos}
        onAddRepo={(repo) => {
          clearPendingRepoFromUrl()
          return handleAddRepo(repo)
        }}
        onSelectExistingRepo={(repoId) => {
          clearPendingRepoFromUrl()
          selectRepo(repoId)
        }}
        initialRepoUrl={pendingRepoFromUrl ? `${pendingRepoFromUrl.owner}/${pendingRepoFromUrl.name}` : undefined}
      />
      {activeRepo && (
        <RepoSettingsModal
          open={repoSettingsOpen}
          onClose={handleRepoSettingsClose}
          repoId={activeRepo.id}
          repoOwner={activeRepo.owner}
          repoName={activeRepo.name}
          initialEnvVars={repoEnvVars ?? undefined}
          onEnvVarsUpdate={handleOpenRepoSettings}
        />
      )}

      {/* Mobile Diff Modal */}
      {isMobile && activeRepo && activeBranch && (
        <DiffModal
          open={mobileDiffOpen}
          onClose={closeMobileDiff}
          repoOwner={activeRepo.owner}
          repoName={activeRepo.name}
          branchName={activeBranch.name}
          baseBranch={activeBranch.baseBranch || activeRepo.defaultBranch}
          startCommit={activeBranch.startCommit}
        />
      )}

      {/* Mobile Git Dialogs (Merge, Rebase, Tag) - shared component */}
      {isMobile && activeRepo && activeBranch && activeBranch.sandboxId && (
        <GitDialogs gitDialogs={mobileGitDialogs} />
      )}
    </>
  )
}
