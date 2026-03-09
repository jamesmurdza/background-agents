"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useStore, generateId } from "@/lib/store"
import type { Repo, Branch, Message, Settings, ToolCall } from "@/lib/types"
import { RepoSidebar } from "@/components/repo-sidebar"
import { BranchList } from "@/components/branch-list"
import { ChatPanel, EmptyChatPanel } from "@/components/chat-panel"
import { GitHistoryPanel } from "@/components/git-history-panel"
import { SettingsModal } from "@/components/settings-modal"
import { AddRepoModal } from "@/components/add-repo-modal"

export default function Home() {
  const { repos, settings, loaded, setRepos, setSettings, forceSave } = useStore()
  const [activeRepoId, setActiveRepoId] = useState<string | null>(null)
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null)
  const activeBranchIdRef = useRef(activeBranchId)
  activeBranchIdRef.current = activeBranchId
  const [mobileView, setMobileView] = useState<"branches" | "chat">("branches")
  const [branchListWidth, setBranchListWidth] = useState(260)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addRepoOpen, setAddRepoOpen] = useState(false)
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false)
  const [gitHistoryRefreshTrigger, setGitHistoryRefreshTrigger] = useState(0)
  const [pendingStartCommit, setPendingStartCommit] = useState<string | null>(null)
  const [githubUser, setGithubUser] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)

  // Fetch GitHub user info when PAT is set
  useEffect(() => {
    if (!settings.githubPat) {
      setGithubUser(null)
      setUserAvatar(null)
      return
    }
    fetch(`/api/github/user?token=${settings.githubPat}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.login) {
          setGithubUser(data.login)
          setUserAvatar(data.avatar || null)
        }
      })
      .catch(() => {})
  }, [settings.githubPat])

  // Auto-select first repo on load
  useEffect(() => {
    if (loaded && repos.length > 0 && !activeRepoId) {
      setActiveRepoId(repos[0].id)
      if (repos[0].branches.length > 0) {
        setActiveBranchId(repos[0].branches[0].id)
      }
    }
  }, [loaded, repos, activeRepoId])

  // Dynamic page title with agent counts
  useEffect(() => {
    const allBranches = repos.flatMap((r) => r.branches)
    const running = allBranches.filter((b) => b.status === "running").length
    const unread = allBranches.filter((b) => b.unread).length
    const parts: string[] = []
    if (running > 0) parts.push(`${running} running`)
    if (unread > 0) parts.push(`${unread} unread`)
    if (running === 0 && unread === 0) parts.push("0 running")
    document.title = parts.join(", ")
  }, [repos])

  // Auto-open settings if not configured
  useEffect(() => {
    const hasAnthropicCredential =
      (settings.anthropicAuthType === "claude-max" && settings.anthropicAuthToken) ||
      settings.anthropicApiKey
    if (loaded && !settings.daytonaApiKey && !hasAnthropicCredential) {
      setSettingsOpen(true)
    }
  }, [loaded, settings])

  const activeRepo = repos.find((r) => r.id === activeRepoId) ?? null
  const activeBranch = activeBranchId && activeRepo
    ? activeRepo.branches.find((b) => b.id === activeBranchId) ?? null
    : null

  function handleSelectRepo(repoId: string) {
    setActiveRepoId(repoId)
    const repo = repos.find((r) => r.id === repoId)
    setActiveBranchId(repo?.branches[0]?.id ?? null)
    setMobileView("branches")
  }

  function handleSelectBranch(branchId: string) {
    // Mark as read
    if (activeRepo) {
      setRepos((prev) =>
        prev.map((r) => {
          if (r.id !== activeRepo.id) return r
          return {
            ...r,
            branches: r.branches.map((b) => {
              if (b.id !== branchId) return b
              return { ...b, unread: false }
            }),
          }
        })
      )
    }
    setActiveBranchId(branchId)
    setMobileView("chat")
  }

  function handleAddRepo(repo: Repo) {
    setRepos((prev) => [...prev, repo])
    setActiveRepoId(repo.id)
    setActiveBranchId(null)
  }

  function handleRemoveRepo(repoId: string) {
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return
    // Clean up sandboxes for all branches
    for (const branch of repo.branches) {
      if (branch.sandboxId && settings.daytonaApiKey) {
        fetch("/api/sandbox/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daytonaApiKey: settings.daytonaApiKey,
            sandboxId: branch.sandboxId,
          }),
        }).catch(() => {})
      }
    }
    setRepos((prev) => prev.filter((r) => r.id !== repoId))
    if (activeRepoId === repoId) {
      const remaining = repos.filter((r) => r.id !== repoId)
      setActiveRepoId(remaining[0]?.id ?? null)
      setActiveBranchId(null)
    }
  }

  const handleAddBranch = useCallback((branch: Branch) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return { ...r, branches: [...r.branches, branch] }
      })
    )
    setActiveBranchId(branch.id)
    setMobileView("chat")
  }, [activeRepo, setRepos])

  const handleUpdateBranch = useCallback((branchId: string, updates: Partial<Branch>) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            const merged = { ...b, ...updates }
            // Mark as unread when agent finishes on a non-active branch
            if (updates.status === "idle" && b.status === "running" && branchId !== activeBranchIdRef.current) {
              merged.unread = true
            }
            return merged
          }),
        }
      })
    )
  }, [activeRepo, setRepos])

  const handleRemoveBranch = useCallback((branchId: string, deleteRemote?: boolean) => {
    if (!activeRepo) return
    // Delete sandbox if exists
    const branch = activeRepo.branches.find((b) => b.id === branchId)
    if (branch?.sandboxId && settings.daytonaApiKey) {
      fetch("/api/sandbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          daytonaApiKey: settings.daytonaApiKey,
          sandboxId: branch.sandboxId,
        }),
      }).catch(() => {}) // Best effort cleanup

      // Delete remote branch on GitHub if requested
      if (deleteRemote && branch && settings.githubPat) {
        fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            daytonaApiKey: settings.daytonaApiKey,
            sandboxId: branch.sandboxId,
            repoPath: `/home/daytona/${activeRepo.name}`,
            action: "delete-remote-branch",
            currentBranch: branch.name,
            githubPat: settings.githubPat,
            repoOwner: activeRepo.owner,
            repoApiName: activeRepo.name,
          }),
        }).catch(() => {}) // Best effort cleanup
      }
    }
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.filter((b) => b.id !== branchId),
        }
      })
    )
    if (activeBranchId === branchId) {
      const remaining = activeRepo.branches.filter((b) => b.id !== branchId)
      setActiveBranchId(remaining[0]?.id ?? null)
    }
  }, [activeRepo, activeBranchId, settings.daytonaApiKey, settings.githubPat, setRepos])

  const handleAddMessage = useCallback((branchId: string, message: Message) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return {
              ...b,
              messages: [...b.messages, message],
              lastActivity: "now",
              lastActivityTs: Date.now(),
              unread: branchId !== activeBranchIdRef.current ? true : b.unread,
            }
          }),
        }
      })
    )
  }, [activeRepo, setRepos])

  const handleUpdateLastMessage = useCallback((branchId: string, updates: Partial<Message>) => {
    if (!activeRepo) return
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            const msgs = [...b.messages]
            // Find last non-commit-pill message
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (!msgs[i].commitHash) {
                msgs[i] = { ...msgs[i], ...updates }
                break
              }
            }
            return { ...b, messages: msgs }
          }),
        }
      })
    )
  }, [activeRepo, setRepos])

  if (!loaded) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </main>
    )
  }

  return (
    <>
      <main className="flex h-dvh overflow-hidden">
        <RepoSidebar
          repos={repos}
          activeRepoId={activeRepoId}
          userAvatar={userAvatar}
          onSelectRepo={handleSelectRepo}
          onRemoveRepo={handleRemoveRepo}
          onReorderRepos={(from, to) => {
            setRepos((prev) => {
              const next = [...prev]
              const [moved] = next.splice(from, 1)
              next.splice(to, 0, moved)
              return next
            })
          }}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenAddRepo={() => setAddRepoOpen(true)}
        />

        <div className="hidden sm:flex">
          {activeRepo ? (
            <BranchList
              repo={activeRepo}
              activeBranchId={activeBranchId}
              onSelectBranch={handleSelectBranch}
              onAddBranch={handleAddBranch}
              onRemoveBranch={handleRemoveBranch}
              onUpdateBranch={handleUpdateBranch}
              settings={settings}
              width={branchListWidth}
              onWidthChange={setBranchListWidth}
              pendingStartCommit={pendingStartCommit}
              onClearPendingCommit={() => setPendingStartCommit(null)}
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

        <div className="flex min-w-0 flex-1">
          {activeBranch && activeRepo ? (
            <ChatPanel
              branch={activeBranch}
              repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
              repoName={activeRepo.name}
              repoOwner={activeRepo.owner}
              settings={settings}
              gitHistoryOpen={gitHistoryOpen}
              onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
              onAddMessage={(msg) => handleAddMessage(activeBranch.id, msg)}
              onUpdateLastMessage={(updates) =>
                handleUpdateLastMessage(activeBranch.id, updates)
              }
              onUpdateBranch={(updates) =>
                handleUpdateBranch(activeBranch.id, updates)
              }
              onForceSave={forceSave}
              onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
              onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
            />
          ) : (
            <EmptyChatPanel hasRepos={repos.length > 0} />
          )}

          {/* Git history panel */}
          {gitHistoryOpen && activeBranch?.sandboxId && activeRepo && (
            <GitHistoryPanel
              sandboxId={activeBranch.sandboxId}
              repoName={activeRepo.name}
              baseBranch={activeBranch.baseBranch}
              settings={settings}
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
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={setSettings}
        repos={repos}
      />
      <AddRepoModal
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        settings={settings}
        githubUser={githubUser}
        existingRepos={repos}
        onAddRepo={handleAddRepo}
        onSelectExistingRepo={handleSelectRepo}
      />
    </>
  )
}
