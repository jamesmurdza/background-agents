"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { RepoSidebar } from "@/components/sidebar/repo-sidebar"
import { BranchList } from "@/components/sidebar/branch-list"
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
  useMobileUIState,
  useMobileHandlers,
  useSyncData,
  useCrossDeviceSync,
  useIsMobile,
  useRepoNavigation,
} from "@/hooks"

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const isMobile = useIsMobile()
  const { repoFromUrl, updateUrlToRepo } = useRepoNavigation()

  // Core data state
  const {
    repos,
    setRepos,
    quota,
    credentials,
    isAdmin,
    loaded,
    messagesLoadingBranchIds,
    refreshQuota,
    refreshCredentials,
    loadBranchMessages,
  } = useRepoData({ isAuthenticated: status === "authenticated" })

  // Selection state
  const {
    activeRepoId,
    activeBranchId,
    activeBranchIdRef,
    activeRepo,
    activeBranch,
    selectRepo: selectRepoInternal,
    selectBranch,
    setActiveBranchId,
  } = useBranchSelection({ repos, loaded, repoFromUrl })

  // Wrap selectRepo to also update URL (without triggering page reload)
  const selectRepo = useCallback(
    (repoId: string) => {
      const repo = repos.find((r) => r.id === repoId)
      if (repo) {
        updateUrlToRepo(repo.owner, repo.name)
      }
      selectRepoInternal(repoId)
    },
    [repos, updateUrlToRepo, selectRepoInternal]
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
    refreshQuota,
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

  // Streaming state ref - signals when a message is actively being streamed
  // This is used to prevent sync from overwriting streaming content
  const streamingMessageIdRef = useRef<string | null>(null)

  // Mobile UI state
  const mobileUI = useMobileUIState()

  // Mobile handlers
  const { handleMobileSandboxToggle, handleMobileCreatePR } = useMobileHandlers({
    activeBranch,
    activeRepo,
    handleUpdateBranch,
    mobileSandboxToggleLoading: mobileUI.mobileSandboxToggleLoading,
    setMobileSandboxToggleLoading: mobileUI.setMobileSandboxToggleLoading,
    mobilePrLoading: mobileUI.mobilePrLoading,
    setMobilePrLoading: mobileUI.setMobilePrLoading,
  })

  // Mobile git dialogs (merge, rebase, tag) - uses shared hook
  const mobileGitDialogs = useGitDialogs({
    branch: activeBranch!,
    repoName: activeRepo?.name || "",
    repoOwner: activeRepo?.owner || "",
    repoFullName: activeRepo ? `${activeRepo.owner}/${activeRepo.name}` : "",
    onAddMessage: handleAddMessage,
  })

  // Cross-device sync
  const { handleSyncData } = useSyncData({ setRepos, activeBranchIdRef, streamingMessageIdRef })
  useCrossDeviceSync({
    enabled: loaded,
    interval: 5000,
    onSyncData: handleSyncData,
  })

  // UI state for desktop components
  const [branchListWidth, setBranchListWidth] = useState(260)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsHighlightField, setSettingsHighlightField] = useState<string | null>(null)
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false)
  const [gitHistoryRefreshTrigger, setGitHistoryRefreshTrigger] = useState(0)
  const [pendingStartCommit, setPendingStartCommit] = useState<string | null>(null)
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false)
  const [repoEnvVars, setRepoEnvVars] = useState<Record<string, boolean> | null>(null)
  const [desktopRebaseConflict, setDesktopRebaseConflict] = useState(false)

  // Handler to open settings with a specific field highlighted
  const handleOpenSettingsWithHighlight = useCallback((field: string) => {
    setSettingsHighlightField(field)
    setSettingsOpen(true)
  }, [])

  // Handler to close settings and clear highlight
  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false)
    setSettingsHighlightField(null)
  }, [])

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
    setRepoSettingsOpen(true)
  }, [activeRepoId])

  // Handler to close repo settings
  const handleRepoSettingsClose = useCallback(() => {
    setRepoSettingsOpen(false)
    setRepoEnvVars(null)
  }, [])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  // Update URL when repo is auto-selected on root page
  useEffect(() => {
    if (!loaded || !activeRepo) return
    // Only update if we're at root (no repo in URL)
    if (!repoFromUrl) {
      updateUrlToRepo(activeRepo.owner, activeRepo.name)
    }
  }, [loaded, activeRepo, repoFromUrl, updateUrlToRepo])

  // Redirect to home if URL repo is not found in user's repos
  useEffect(() => {
    if (!loaded || repos.length === 0 || !repoFromUrl) return

    const matchingRepo = repos.find(
      (r) =>
        r.owner.toLowerCase() === repoFromUrl.owner.toLowerCase() &&
        r.name.toLowerCase() === repoFromUrl.name.toLowerCase()
    )

    if (!matchingRepo) {
      // URL repo not found, redirect to home
      router.replace("/")
    }
  }, [loaded, repos, repoFromUrl, router])

  // Load messages when active branch changes
  useEffect(() => {
    if (activeBranchId && activeRepoId) {
      loadBranchMessages(activeBranchId, activeRepoId)
    }
  }, [activeBranchId, activeRepoId, loadBranchMessages])

  useEffect(() => {
    if (!activeBranch) setDesktopRebaseConflict(false)
  }, [activeBranch])

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

  // No longer auto-open settings - users can use OpenCode with free models without API keys

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
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAddRepo={() => setAddRepoOpen(true)}
            onSignOut={() => signOut({ callbackUrl: "/login" })}
            quota={quota}
            isAdmin={isAdmin}
          />
        )}

        {/* Mobile Sidebar Drawer */}
        {isMobile && (
          <MobileSidebarDrawer
            open={mobileUI.mobileSidebarOpen}
            onOpenChange={mobileUI.setMobileSidebarOpen}
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
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAddRepo={() => setAddRepoOpen(true)}
            onSignOut={() => signOut({ callbackUrl: "/login" })}
            quota={quota}
            onAddBranch={handleAddBranch}
            onUpdateBranch={handleUpdateBranch}
            onQuotaRefresh={refreshQuota}
            credentials={credentials}
            onRemoveBranch={(branchId, deleteRemote) => handleRemoveBranch(branchId, deleteRemote, activeBranchId ?? undefined)}
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
              onUpdateBranch={handleUpdateBranch}
              onQuotaRefresh={refreshQuota}
              width={branchListWidth}
              onWidthChange={setBranchListWidth}
              pendingStartCommit={pendingStartCommit}
              onClearPendingCommit={() => setPendingStartCommit(null)}
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
                mobileGitDialogs.rebaseConflict?.inRebase &&
                "border-2 border-red-600 dark:border-red-500"
            )}
          >
            {/* Mobile Header with hamburger and actions */}
            <MobileHeader
              repoOwner={activeRepo?.owner || null}
              repoName={activeRepo?.name || null}
              branch={activeBranch}
              onOpenSidebar={() => mobileUI.setMobileSidebarOpen(true)}
              onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
              onOpenDiff={() => mobileUI.setMobileDiffOpen(true)}
              onCreatePR={handleMobileCreatePR}
              onSandboxToggle={handleMobileSandboxToggle}
              onMerge={() => mobileGitDialogs.setMergeOpen(true)}
              onRebase={() => mobileGitDialogs.setRebaseOpen(true)}
              gitHistoryOpen={gitHistoryOpen}
              sandboxToggleLoading={mobileUI.mobileSandboxToggleLoading}
              prLoading={mobileUI.mobilePrLoading}
              onUpdateBranch={handleUpdateBranch}
              credentials={credentials}
              rebaseConflict={mobileGitDialogs.rebaseConflict}
              onAbortRebase={mobileGitDialogs.handleAbortRebase}
              abortLoading={mobileGitDialogs.actionLoading}
            />

            {/* Chat content */}
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
              {activeBranch && activeRepo ? (
                <ChatPanel
                  key={`${activeRepo.id}-${activeBranch.name}`}
                  branch={activeBranch}
                  repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
                  repoName={activeRepo.name}
                  repoOwner={activeRepo.owner}
                  gitHistoryOpen={gitHistoryOpen}
                  onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
                  onAddMessage={handleAddMessage}
                  onUpdateMessage={handleUpdateMessage}
                  onUpdateBranch={handleUpdateBranch}
                  onSaveDraftForBranch={handleSaveDraftForBranch}
                  onForceSave={() => {}}
                  onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
                  onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
                  messagesLoading={messagesLoadingBranchIds.has(activeBranch.id)}
                  isMobile={true}
                  streamingMessageIdRef={streamingMessageIdRef}
                  credentials={credentials}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenSettingsWithHighlight={handleOpenSettingsWithHighlight}
                  defaultLoopMaxIterations={credentials?.defaultLoopMaxIterations}
                  loopUntilFinishedEnabled={credentials?.loopUntilFinishedEnabled}
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
            onOpenChange={setGitHistoryOpen}
            sandboxId={activeBranch.sandboxId}
            repoName={activeRepo.name}
            baseBranch={activeBranch.baseBranch}
            refreshTrigger={gitHistoryRefreshTrigger}
            onScrollToCommit={(shortHash) => {
              document.getElementById(`commit-${shortHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
            onBranchFromCommit={(commitHash) => setPendingStartCommit(commitHash)}
          />
        )}

        {/* Desktop: Main content area (branch list is outside this wrapper) */}
        {!isMobile && (
        <div
          className={cn(
            "flex min-h-0 min-w-0 flex-1",
            desktopRebaseConflict && "border-2 border-red-600 dark:border-red-500"
          )}
        >
          {activeBranch && activeRepo ? (
            <ChatPanel
              key={`${activeRepo.id}-${activeBranch.name}`}
              branch={activeBranch}
              repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
              repoName={activeRepo.name}
              repoOwner={activeRepo.owner}
              gitHistoryOpen={gitHistoryOpen}
              onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
              onAddMessage={handleAddMessage}
              onUpdateMessage={handleUpdateMessage}
              onUpdateBranch={handleUpdateBranch}
              onSaveDraftForBranch={handleSaveDraftForBranch}
              onForceSave={() => {}}
              onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
              onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
              messagesLoading={messagesLoadingBranchIds.has(activeBranch.id)}
              streamingMessageIdRef={streamingMessageIdRef}
              credentials={credentials}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenSettingsWithHighlight={handleOpenSettingsWithHighlight}
              defaultLoopMaxIterations={credentials?.defaultLoopMaxIterations}
              loopUntilFinishedEnabled={credentials?.loopUntilFinishedEnabled}
              onRebaseConflictChange={setDesktopRebaseConflict}
            />
          ) : (
            <EmptyChatPanel hasRepos={repos.length > 0} />
          )}

          {gitHistoryOpen && activeBranch?.sandboxId && activeRepo && (
            <GitHistoryPanel
              sandboxId={activeBranch.sandboxId}
              repoName={activeRepo.name}
              baseBranch={activeBranch.baseBranch}
              onClose={() => setGitHistoryOpen(false)}
              refreshTrigger={gitHistoryRefreshTrigger}
              onScrollToCommit={(shortHash) => {
                document.getElementById(`commit-${shortHash}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
              }}
              onBranchFromCommit={(commitHash) => setPendingStartCommit(commitHash)}
            />
          )}
        </div>
        )}
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={handleSettingsClose}
        credentials={credentials}
        onCredentialsUpdate={refreshCredentials}
        highlightField={settingsHighlightField}
        onClearHighlight={() => setSettingsHighlightField(null)}
      />
      <AddRepoModal
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        githubUser={session?.user?.githubLogin || null}
        existingRepos={repos}
        onAddRepo={handleAddRepo}
        onSelectExistingRepo={selectRepo}
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
          open={mobileUI.mobileDiffOpen}
          onClose={() => mobileUI.setMobileDiffOpen(false)}
          repoOwner={activeRepo.owner}
          repoName={activeRepo.name}
          branchName={activeBranch.name}
          baseBranch={activeBranch.baseBranch || activeRepo.defaultBranch}
        />
      )}

      {/* Mobile Git Dialogs (Merge, Rebase, Tag) - shared component */}
      {isMobile && activeRepo && activeBranch && activeBranch.sandboxId && (
        <GitDialogs gitDialogs={mobileGitDialogs} />
      )}
    </>
  )
}
