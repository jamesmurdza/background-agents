"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { generateId } from "@/lib/store"
import type { Branch, Message } from "@/lib/types"
import { RepoSidebar } from "@/components/repo-sidebar"
import { BranchList } from "@/components/branch-list"
import { ChatPanel, EmptyChatPanel } from "@/components/chat-panel"
import { GitHistoryPanel } from "@/components/git-history-panel"
import { SettingsModal } from "@/components/settings-modal"
import { AddRepoModal } from "@/components/add-repo-modal"
import { Loader2, ChevronLeft, GitBranch } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

// Types for database models
interface DbSandbox {
  id: string
  sandboxId: string
  contextId: string | null
  sessionId: string | null
  previewUrlPattern: string | null
  status: string
}

interface DbMessage {
  id: string
  role: string
  content: string
  toolCalls: unknown
  timestamp: string | null
  commitHash: string | null
  commitMessage: string | null
}

interface DbBranch {
  id: string
  name: string
  baseBranch: string | null
  startCommit: string | null
  status: string
  prUrl: string | null
  draftPrompt: string | null
  sandbox: DbSandbox | null
  messages: DbMessage[]
}

interface DbRepo {
  id: string
  name: string
  owner: string
  avatar: string | null
  defaultBranch: string
  branches: DbBranch[]
}

interface Quota {
  current: number
  max: number
  remaining: number
}

interface UserCredentials {
  anthropicAuthType: string
  hasAnthropicApiKey: boolean
  hasAnthropicAuthToken: boolean
}

// Transform DB data to frontend format
function transformBranch(dbBranch: DbBranch): Branch {
  return {
    id: dbBranch.id,
    name: dbBranch.name,
    baseBranch: dbBranch.baseBranch || "main",
    startCommit: dbBranch.startCommit || undefined,
    status: dbBranch.status as Branch["status"],
    prUrl: dbBranch.prUrl || undefined,
    draftPrompt: dbBranch.draftPrompt || undefined,
    sandboxId: dbBranch.sandbox?.sandboxId,
    contextId: dbBranch.sandbox?.contextId || undefined,
    sessionId: dbBranch.sandbox?.sessionId || undefined,
    previewUrlPattern: dbBranch.sandbox?.previewUrlPattern || undefined,
    messages: dbBranch.messages.map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      toolCalls: m.toolCalls as Message["toolCalls"],
      timestamp: m.timestamp || "",
      commitHash: m.commitHash || undefined,
      commitMessage: m.commitMessage || undefined,
    })),
  }
}

function transformRepo(dbRepo: DbRepo) {
  return {
    id: dbRepo.id,
    name: dbRepo.name,
    owner: dbRepo.owner,
    avatar: dbRepo.avatar || "",
    defaultBranch: dbRepo.defaultBranch,
    branches: dbRepo.branches.map(transformBranch),
  }
}

export default function Home() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const isMobile = useIsMobile()

  const [repos, setRepos] = useState<ReturnType<typeof transformRepo>[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [credentials, setCredentials] = useState<UserCredentials | null>(null)
  const [loaded, setLoaded] = useState(false)

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

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  // Fetch user data on mount
  useEffect(() => {
    if (status !== "authenticated") return

    fetch("/api/user/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.repos) {
          const transformedRepos = data.repos.map(transformRepo)
          setRepos(transformedRepos)
        }
        if (data.quota) {
          setQuota(data.quota)
        }
        if (data.credentials) {
          setCredentials(data.credentials)
        }
        setLoaded(true)
      })
      .catch((err) => {
        console.error("Failed to fetch user data:", err)
        setLoaded(true)
      })
  }, [status])

  // Auto-select first repo/branch on load
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
    const parts: string[] = []
    if (running > 0) parts.push(`${running} running`)
    if (running === 0) parts.push("0 running")
    document.title = parts.join(", ")
  }, [repos])

  // Auto-open settings if Anthropic credentials not configured
  useEffect(() => {
    if (
      loaded &&
      (
        !credentials ||
        (!credentials.hasAnthropicApiKey && !credentials.hasAnthropicAuthToken)
      )
    ) {
      setSettingsOpen(true)
    }
  }, [loaded, credentials])

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
    setActiveBranchId(branchId)
    setMobileView("chat")
  }

  function handleAddRepo(repo: ReturnType<typeof transformRepo>) {
    setRepos((prev) => [...prev, repo])
    setActiveRepoId(repo.id)
    setActiveBranchId(null)
  }

  function handleRemoveRepo(repoId: string) {
    const repo = repos.find((r) => r.id === repoId)
    if (!repo) return

    // Clean up sandboxes for all branches
    for (const branch of repo.branches) {
      if (branch.sandboxId) {
        fetch("/api/sandbox/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sandboxId: branch.sandboxId }),
        }).catch(() => {})
      }
    }

    // Delete repo from database
    fetch(`/api/repos?id=${repoId}`, { method: "DELETE" }).catch(() => {})

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
  }, [activeRepo])

  const handleQuotaRefresh = useCallback(() => {
    fetch("/api/user/quota")
      .then((r) => r.json())
      .then((q) => setQuota(q))
      .catch(() => {})
  }, [])

  const handleUpdateBranch = useCallback((branchId: string, updates: Partial<Branch>) => {
    if (!activeRepo) return

    // Find the branch to check its current status
    const branch = activeRepo.branches.find((b) => b.id === branchId)
    const isBeingCreated = branch?.status === "creating"

    // The actual ID to use for database operations (might be a new server-side ID)
    const dbBranchId = updates.id || branchId

    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            // If updates include a new id, use it to replace the branch id
            const newBranch = { ...b, ...updates }
            if (updates.id) {
              newBranch.id = updates.id
            }
            return newBranch
          }),
        }
      })
    )

    // Also update activeBranchId if it's being replaced
    if (updates.id && activeBranchIdRef.current === branchId) {
      setActiveBranchId(updates.id)
    }

    // Only update in database if branch exists there (not during creation)
    // When id is provided, we're transitioning from client-side to server-side ID
    const shouldPersist = !isBeingCreated || updates.id
    if (shouldPersist && (updates.status || updates.prUrl || updates.name || updates.draftPrompt !== undefined)) {
      fetch("/api/branches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: dbBranchId, ...updates }),
      }).catch(() => {})
    }
  }, [activeRepo])

  const handleRemoveBranch = useCallback((branchId: string, deleteRemote?: boolean) => {
    if (!activeRepo) return
    const branch = activeRepo.branches.find((b) => b.id === branchId)

    if (branch?.sandboxId) {
      fetch("/api/sandbox/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: branch.sandboxId }),
      }).catch(() => {})

      if (deleteRemote && branch) {
        fetch("/api/sandbox/git", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: branch.sandboxId,
            repoPath: `/home/daytona/${activeRepo.name}`,
            action: "delete-remote-branch",
            currentBranch: branch.name,
            repoOwner: activeRepo.owner,
            repoApiName: activeRepo.name,
          }),
        }).catch(() => {})
      }
    }

    // Delete from database
    fetch(`/api/branches?id=${branchId}`, { method: "DELETE" }).catch(() => {})

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

    // Refresh quota
    fetch("/api/user/quota")
      .then((r) => r.json())
      .then((q) => setQuota(q))
      .catch(() => {})
  }, [activeRepo, activeBranchId])

  // Save draft for a specific branch (used when switching branches to persist the previous branch's draft)
  const handleSaveDraftForBranch = useCallback((branchId: string, draftPrompt: string) => {
    if (!activeRepo) return

    // Update local state
    setRepos((prev) =>
      prev.map((r) => {
        if (r.id !== activeRepo.id) return r
        return {
          ...r,
          branches: r.branches.map((b) => {
            if (b.id !== branchId) return b
            return { ...b, draftPrompt }
          }),
        }
      })
    )

    // Persist to database
    fetch("/api/branches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId, draftPrompt }),
    }).catch(() => {})
  }, [activeRepo])

  const handleAddMessage = useCallback(async (branchId: string, message: Message): Promise<string> => {
    if (!activeRepo) return message.id

    // Add message to local state immediately with temporary ID
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
            }
          }),
        }
      })
    )

    // Save message to database and get the real DB ID
    try {
      const res = await fetch("/api/branches/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          role: message.role,
          content: message.content,
          toolCalls: message.toolCalls,
          timestamp: message.timestamp,
          commitHash: message.commitHash,
          commitMessage: message.commitMessage,
        }),
      })

      if (!res.ok) {
        console.error("Failed to save message to database:", res.status, res.statusText)
        return message.id
      }

      const data = await res.json()
      const dbId = data.message?.id

      if (dbId && dbId !== message.id) {
        // Update local state with the real database ID
        setRepos((prev) =>
          prev.map((r) => {
            if (r.id !== activeRepo.id) return r
            return {
              ...r,
              branches: r.branches.map((b) => {
                if (b.id !== branchId) return b
                return {
                  ...b,
                  messages: b.messages.map((m) =>
                    m.id === message.id ? { ...m, id: dbId } : m
                  ),
                }
              }),
            }
          })
        )
        return dbId
      }
      return message.id
    } catch (error) {
      console.error("Error saving message to database:", error)
      return message.id
    }
  }, [activeRepo])

  const handleUpdateMessage = useCallback((branchId: string, messageId: string, updates: Partial<Message>) => {
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
              messages: b.messages.map((m) =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
            }
          }),
        }
      })
    )

    // Update message in database
    fetch("/api/branches/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId,
        content: updates.content,
        toolCalls: updates.toolCalls,
      }),
    }).catch((error) => {
      console.error("Error updating message in database:", error)
    })
  }, [activeRepo])

  const handleCredentialsUpdate = useCallback(() => {
    // Refresh credentials state
    fetch("/api/user/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.credentials) {
          setCredentials(data.credentials)
        }
      })
      .catch(() => {})
  }, [])

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
        {/* Repo Sidebar - always visible */}
        <RepoSidebar
          repos={repos}
          activeRepoId={activeRepoId}
          userAvatar={session?.user?.image || null}
          userName={session?.user?.name || null}
          userLogin={session?.user?.githubLogin || null}
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
          onSignOut={() => signOut({ callbackUrl: "/login" })}
          quota={quota}
        />

        {/* Desktop: Branch List (always visible) */}
        <div className="hidden sm:flex">
          {activeRepo ? (
            <BranchList
              repo={activeRepo}
              activeBranchId={activeBranchId}
              onSelectBranch={handleSelectBranch}
              onAddBranch={handleAddBranch}
              onRemoveBranch={handleRemoveBranch}
              onUpdateBranch={handleUpdateBranch}
              onQuotaRefresh={handleQuotaRefresh}
              width={branchListWidth}
              onWidthChange={setBranchListWidth}
              pendingStartCommit={pendingStartCommit}
              onClearPendingCommit={() => setPendingStartCommit(null)}
              quota={quota}
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

        {/* Mobile: Branch List (fullscreen, shown when mobileView === "branches") */}
        {isMobile && mobileView === "branches" && (
          <div className="flex flex-1 flex-col sm:hidden">
            {activeRepo ? (
              <BranchList
                repo={activeRepo}
                activeBranchId={activeBranchId}
                onSelectBranch={handleSelectBranch}
                onAddBranch={handleAddBranch}
                onRemoveBranch={handleRemoveBranch}
                onUpdateBranch={handleUpdateBranch}
                onQuotaRefresh={handleQuotaRefresh}
                width="100%"
                onWidthChange={() => {}}
                pendingStartCommit={pendingStartCommit}
                onClearPendingCommit={() => setPendingStartCommit(null)}
                quota={quota}
                isMobile={true}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center bg-card text-muted-foreground px-4">
                <GitBranch className="h-8 w-8 mb-3 text-muted-foreground/50" />
                <p className="text-sm text-center">Add a repository to get started</p>
                <p className="text-xs text-muted-foreground/60 mt-1 text-center">
                  Tap the + button in the sidebar
                </p>
              </div>
            )}
          </div>
        )}

        {/* Mobile: Chat Panel (fullscreen, shown when mobileView === "chat") */}
        {isMobile && mobileView === "chat" && (
          <div className="flex min-w-0 flex-1 flex-col sm:hidden overflow-hidden">
            {/* Mobile header with back button */}
            <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
              <button
                onClick={() => setMobileView("branches")}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              {activeRepo && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-muted-foreground truncate">
                    {activeRepo.owner}/{activeRepo.name}
                  </span>
                  {activeBranch && (
                    <>
                      <span className="text-muted-foreground/30">/</span>
                      <span className="text-xs font-medium text-foreground truncate">
                        {activeBranch.name}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            {activeBranch && activeRepo ? (
              <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
                <ChatPanel
                branch={activeBranch}
                repoFullName={`${activeRepo.owner}/${activeRepo.name}`}
                repoName={activeRepo.name}
                repoOwner={activeRepo.owner}
                gitHistoryOpen={gitHistoryOpen}
                onToggleGitHistory={() => setGitHistoryOpen((v) => !v)}
                onAddMessage={(msg) => handleAddMessage(activeBranch.id, msg)}
                onUpdateMessage={(messageId, updates) =>
                  handleUpdateMessage(activeBranch.id, messageId, updates)
                }
                onUpdateBranch={(updates) =>
                  handleUpdateBranch(activeBranch.id, updates)
                }
                onSaveDraftForBranch={handleSaveDraftForBranch}
                onForceSave={() => {}}
                onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
                onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
                isMobile={true}
              />
              </div>
            ) : (
              <EmptyChatPanel hasRepos={repos.length > 0} />
            )}
          </div>
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
              onAddMessage={(msg) => handleAddMessage(activeBranch.id, msg)}
              onUpdateMessage={(messageId, updates) =>
                handleUpdateMessage(activeBranch.id, messageId, updates)
              }
              onUpdateBranch={(updates) =>
                handleUpdateBranch(activeBranch.id, updates)
              }
              onSaveDraftForBranch={handleSaveDraftForBranch}
              onForceSave={() => {}}
              onCommitsDetected={() => setGitHistoryRefreshTrigger((n) => n + 1)}
              onBranchFromCommit={(hash) => setPendingStartCommit(hash)}
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
        onClose={() => setSettingsOpen(false)}
        credentials={credentials}
        onCredentialsUpdate={handleCredentialsUpdate}
      />
      <AddRepoModal
        open={addRepoOpen}
        onClose={() => setAddRepoOpen(false)}
        githubUser={session?.user?.githubLogin || null}
        existingRepos={repos}
        onAddRepo={handleAddRepo}
        onSelectExistingRepo={handleSelectRepo}
      />
    </>
  )
}
