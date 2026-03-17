"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { RepoSidebar } from "@/components/repo-sidebar"
import { BranchList } from "@/components/branch-list"
import { ChatPanel, EmptyChatPanel } from "@/components/chat-panel"
import { BackgroundExecutionPoller } from "@/components/chat/background-execution-poller"
import { GitHistoryPanel } from "@/components/git-history-panel"
import { GitHistorySheet } from "@/components/git-history-sheet"
import { SettingsModal } from "@/components/settings-modal"
import { RepoSettingsModal } from "@/components/repo-settings-modal"
import { AddRepoModal } from "@/components/add-repo-modal"
import { MobileHeader } from "@/components/mobile-header"
import { MobileSidebarDrawer } from "@/components/mobile-sidebar-drawer"
import { DiffModal } from "@/components/diff-modal"
import { BRANCH_STATUS } from "@/lib/constants"
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
} from "@/hooks"

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const isMobile = useIsMobile()

  // Core data state
  const {
    repos,
    setRepos,
    quota,
    credentials,
    isAdmin,
    loaded,
    messagesLoading,
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
    selectRepo,
    selectBranch,
    setActiveBranchId,
  } = useBranchSelection({ repos, loaded })

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

  // Load messages when active branch changes
  useEffect(() => {
    if (activeBranchId && activeRepoId) {
      loadBranchMessages(activeBranchId, activeRepoId)
    }
  }, [activeBranchId, activeRepoId, loadBranchMessages])

  // Dynamic page title with agent counts
  useEffect(() => {
    const allBranches = repos.flatMap((r) => r.branches)
    const running = allBranches.filter((b) => b.status === BRANCH_STATUS.RUNNING).length
    const parts: string[] = []
    if (running > 0) parts.push(`${running} running`)
    if (running === 0) parts.push("0 running")
    document.title = parts.join(", ")
  }, [repos])

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
      {repos.flatMap((r) =>
        r.branches
          .filter(
            (b) =>
              (b.status === BRANCH_STATUS.RUNNING || b.status === BRANCH_STATUS.CREATING) &&
              b.id !== activeBranchId
          )
          .map((b) => (
            <BackgroundExecutionPoller
              key={b.id}
              branch={b}
              repoName={r.name}
              onUpdateMessage={handleUpdateMessage}
              onUpdateBranch={handleUpdateBranch}
              onAddMessage={handleAddMessage}
              onForceSave={() => {}}
              onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
              streamingMessageIdRef={streamingMessageIdRef}
              globalActiveBranchIdRef={activeBranchIdRef}
            />
          ))
      )}
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
          />
        )}

        {/* Desktop: Branch List (always visible) */}
        <div className="hidden sm:flex">
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

        {/* Mobile: Header + Chat (Slack-like layout) */}
        {isMobile && (
          <div className="flex flex-1 flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden sm:hidden">
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
              onMerge={() => mobileUI.setMobileMergeOpen(true)}
              onRebase={() => mobileUI.setMobileRebaseOpen(true)}
              onReset={() => mobileUI.setMobileResetOpen(true)}
              onTag={() => mobileUI.setMobileTagOpen(true)}
              gitHistoryOpen={gitHistoryOpen}
              sandboxToggleLoading={mobileUI.mobileSandboxToggleLoading}
              prLoading={mobileUI.mobilePrLoading}
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
                  onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
                  onAddMessage={handleAddMessage}
                  onUpdateMessage={handleUpdateMessage}
                  onUpdateBranch={handleUpdateBranch}
                  onSaveDraftForBranch={handleSaveDraftForBranch}
                  onForceSave={() => {}}
                  onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
                  onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
                  messagesLoading={messagesLoading}
                  isMobile={true}
                  streamingMessageIdRef={streamingMessageIdRef}
                  credentials={credentials}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOpenSettingsWithHighlight={handleOpenSettingsWithHighlight}
                  defaultLoopMaxIterations={credentials?.defaultLoopMaxIterations}
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

        {/* Desktop: Main content area */}
        <div className="hidden sm:flex min-w-0 flex-1">
          {activeBranch && activeRepo ? (
            <ChatPanel
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
              messagesLoading={messagesLoading}
              streamingMessageIdRef={streamingMessageIdRef}
              credentials={credentials}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenSettingsWithHighlight={handleOpenSettingsWithHighlight}
              defaultLoopMaxIterations={credentials?.defaultLoopMaxIterations}
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
    </>
  )
}
