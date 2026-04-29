"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import { nanoid } from "nanoid"
import { Menu, MoreVertical } from "lucide-react"
import { Sidebar, ALL_REPOSITORIES, NO_REPOSITORY } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { PreviewView, type PreviewItem } from "@/components/PreviewView"
import { RepoPickerModal } from "@/components/modals/RepoPickerModal"
import { SettingsModal, type HighlightKey } from "@/components/modals/SettingsModal"
import { SignInModal } from "@/components/modals/SignInModal"
import { HelpModal } from "@/components/modals/HelpModal"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { BranchPickerModal } from "@/components/modals/BranchPickerModal"
import { MergeDialog, RebaseDialog, PRDialog, SquashDialog, ForcePushDialog, useGitDialogs } from "@/components/modals/GitDialogs"
import { MobileCommandsMenu } from "@/components/MobileCommandsMenu"
import { clearAllStorage } from "@/lib/storage"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { PaletteProvider } from "@/components/search-palette"
import { useChatWithSync } from "@/lib/hooks/useChatWithSync"
import { useMobile } from "@/lib/hooks/useMobile"
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

export default function HomePage() {
  const { data: session } = useSession()
  const isMobile = useMobile()

  const {
    chats,
    currentChat,
    currentChatId,
    settings,
    credentialFlags,
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
  } = useChatWithSync()

  const [repoSelectOpen, setRepoSelectOpen] = useState(false)
  const [repoCreateOpen, setRepoCreateOpen] = useState(false)
  const [branchSelectOpen, setBranchSelectOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsHighlightKey, setSettingsHighlightKey] = useState<HighlightKey>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [signInModalOpen, setSignInModalOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [deleteConfirmChatId, setDeleteConfirmChatId] = useState<string | null>(null)
  const [mobileCommandsOpen, setMobileCommandsOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [collapsedChatIds, setCollapsedChatIds] = useState<Set<string>>(new Set())
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window === "undefined") return 520
    const stored = Number(window.localStorage.getItem("simple-chat-preview-width"))
    return Number.isFinite(stored) && stored >= 320 ? stored : 520
  })
  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem("simple-chat-preview-width", String(Math.round(previewWidth)))
  }, [previewWidth])
  const [isResizingPreview, setIsResizingPreview] = useState(false)

  // Track ports we've already auto-opened in each sandbox so the preview pane
  // only pops open the *first* time a new server appears — not every poll.
  const autoOpenedServersRef = useRef<Map<string, Set<number>>>(new Map())

  // Use TanStack Query for server polling
  const serversQuery = useServersQuery(
    currentChat?.sandboxId,
    currentChat?.previewUrlPattern
  )
  const availableServers = serversQuery.data ?? []
  // Preview state lives on each Chat, not globally — switching chats shows
  // whatever that chat last had open (or hides the pane if none).
  const previewItem = (currentChat?.previewItem ?? null) as PreviewItem | null
  const previewOpen = previewItem !== null
  const openPreview = useCallback((next: PreviewItem) => {
    updateCurrentChat({ previewItem: next })
  }, [updateCurrentChat])
  const closePreview = useCallback(() => {
    updateCurrentChat({ previewItem: undefined })
  }, [updateCurrentChat])
  const resizingPreview = useRef(false)
  const startPreviewResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizingPreview.current = true
    setIsResizingPreview(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizingPreview.current) return
      const nextWidth = window.innerWidth - e.clientX
      // Clamp: keep the preview at least 320px wide, but also leave enough
      // room for the chat column on the left.
      const MIN_PREVIEW = 320
      const MIN_CHAT = 600
      const maxPreview = Math.max(MIN_PREVIEW, window.innerWidth - MIN_CHAT)
      setPreviewWidth(Math.max(MIN_PREVIEW, Math.min(maxPreview, nextWidth)))
    }
    const up = () => {
      if (!resizingPreview.current) return
      resizingPreview.current = false
      setIsResizingPreview(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
    }
  }, [])
  const toggleChatCollapsed = useCallback((id: string) => {
    setCollapsedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])
  const expandChatAndAncestors = useCallback((targetId: string, byId: Map<string, Chat>) => {
    setCollapsedChatIds((prev) => {
      let next = prev
      let cur = byId.get(targetId)?.parentChatId
      while (cur) {
        if (next.has(cur)) {
          if (next === prev) next = new Set(prev)
          next.delete(cur)
        }
        cur = byId.get(cur)?.parentChatId
      }
      return next
    })
  }, [])
  // Track if we've already processed a pending message (to avoid double-sending)
  const pendingMessageProcessed = useRef(false)

  // Draft chat agent/model — only used when an unauthenticated user is
  // composing a message before any real chat exists. Stored locally because
  // the chat row that would normally hold these doesn't exist yet.
  const [draftAgent, setDraftAgent] = useState<string | null>(null)
  const [draftModel, setDraftModel] = useState<string | null>(null)

  // Repository filter state (shared with Sidebar)
  const [repoFilter, setRepoFilter] = useState<string>(ALL_REPOSITORIES)

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
        updateCurrentChat({ previewItem: { type: "server", port: newServer.port, url: newServer.url } })
      }
    }
  }, [availableServers, currentChat?.sandboxId, currentChat?.id, updateCurrentChat])

  // Handler for adding messages to current chat
  const handleAddMessage = useCallback((message: Message) => {
    if (currentChatId) {
      addMessage(currentChatId, message)
    }
  }, [currentChatId, addMessage])

  // Git dialogs state - now uses API calls
  const gitDialogs = useGitDialogs({
    chat: currentChat ?? null,
    onAddMessage: handleAddMessage,
    onAddMessageToBranch: (branch, message) => {
      if (!currentChat) return
      const target = chats.find(
        (c) => c.id !== currentChat.id && c.repo === currentChat.repo && c.branch === branch
      )
      if (target) addMessage(target.id, message)
    },
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
  })

  // Close mobile sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarOpen(false)
    }
  }, [isMobile])


  // Handler for opening settings (optionally with a highlighted API key field)
  const handleOpenSettings = (highlightKey?: HighlightKey) => {
    setSettingsHighlightKey(highlightKey ?? null)
    setSettingsOpen(true)
    // Close mobile sidebar when opening settings
    if (isMobile) {
      setMobileSidebarOpen(false)
    }
  }

  // Handler for closing settings
  const handleCloseSettings = () => {
    setSettingsOpen(false)
    setSettingsHighlightKey(null)
  }

  // Auto-create a new chat if none exists after hydration. Skip when there
  // is a pending message in sessionStorage — the replay effect below will
  // create a chat for the message itself and we don't want to create two.
  useEffect(() => {
    if (!isHydrated || currentChatId || !session) return
    if (typeof window !== "undefined" && sessionStorage.getItem(PENDING_MESSAGE_KEY)) return
    startNewChat()
  }, [isHydrated, currentChatId, session, startNewChat])

  // Handler for new chat - uses current chat's repo/branch if available, otherwise repo filter
  const handleNewChat = () => {
    if (!session) {
      setSignInModalOpen(true)
      return
    }
    // If there's a current chat with a repo selected, inherit its repo and base branch.
    // Sibling chat — no parentChatId, and use baseBranch (not the working branch) so the
    // new chat starts from the same point the current one did.
    if (currentChat && currentChat.repo !== NEW_REPOSITORY) {
      startNewChat(currentChat.repo, currentChat.baseBranch)
    } else if (repoFilter !== ALL_REPOSITORIES && repoFilter !== NO_REPOSITORY) {
      // If a specific repo is selected in the filter, use it for the new chat
      // Find the repo to get the default branch
      const repo = repos.find(r => `${r.owner.login}/${r.name}` === repoFilter)
      startNewChat(repoFilter, repo?.default_branch ?? "main")
    } else {
      // Default to NEW_REPOSITORY (no repo)
      startNewChat()
    }
  }

  // Handler for selecting a chat - switch to chat view
  const handleSelectChat = (chatId: string) => {
    selectChat(chatId)
  }

  // Handler for the repo button in the ChatPanel header. Routes to the Select
  // modal when the chat can still choose an existing repo, otherwise to Create
  // (the only other option for a locked NEW_REPOSITORY chat). The two modals
  // are independent — neither links to the other.
  const handleChangeRepo = () => {
    if (!session) {
      setSignInModalOpen(true)
      return
    }
    const chat = currentChat
    const canSelect = !!chat && chat.messages.length === 0 && !chat.sandboxId
    if (canSelect) {
      setRepoSelectOpen(true)
    } else {
      setRepoCreateOpen(true)
    }
  }

  // Handler for the branch button in the ChatPanel header.
  // Opens branch selection modal for the currently selected repository.
  const handleChangeBranch = () => {
    if (!session) {
      setSignInModalOpen(true)
      return
    }
    const chat = currentChat
    if (!chat || chat.repo === NEW_REPOSITORY) return
    // Just open the branch picker - it will fetch branches for the current repo
    setBranchSelectOpen(true)
  }

  // Handler for the Create Repository palette/slash command.
  const handleCreateRepo = () => {
    if (!session) {
      setSignInModalOpen(true)
      return
    }
    setRepoCreateOpen(true)
  }

  // Handler for repo selection - updates the current chat's repo
  // If sandbox already exists (chat started without repo), also set up remote and push
  const handleRepoSelect = async (repo: string, branch: string) => {
    if (!currentChatId || !currentChat) return

    // If sandbox exists, we need to set up the remote and push
    if (currentChat.sandboxId && currentChat.repo === NEW_REPOSITORY) {
      try {
        const response = await fetch("/api/git/setup-remote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sandboxId: currentChat.sandboxId,
            repoFullName: repo,
            branch: currentChat.branch,
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

    updateChatRepo(currentChatId, repo, branch)
  }

  // Handler for sending message
  const handleSendMessage = (message: string, agent: string, model: string, files?: File[]) => {
    // Always require sign-in to send messages
    if (!session) {
      // Store the pending message in sessionStorage (persists across OAuth redirect)
      // Note: files cannot be persisted, so we warn the user if they have attachments
      savePendingMessage({ message, agent, model })
      setSignInModalOpen(true)
      return
    }

    // Update filter to match the chat's repo if this is the first message and repo differs from filter
    // This ensures the filter follows the user's choice when starting a chat
    if (currentChat && currentChat.messages.length === 0 &&
        repoFilter !== ALL_REPOSITORIES && repoFilter !== currentChat.repo) {
      // If chat has no repo, switch to "No repository" filter
      // Otherwise, switch to the chat's repo
      if (currentChat.repo === NEW_REPOSITORY) {
        setRepoFilter(NO_REPOSITORY)
      } else {
        setRepoFilter(currentChat.repo)
      }
    }

    sendMessage(message, agent, model, files)
  }

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
    setSignInModalOpen(false)

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
  }, [session, isHydrated, startNewChat, updateChatById, currentChatId])

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
      setSignInModalOpen(true)
      return
    }
    startNewChat(currentChat.repo, branchForNewChat, currentChat.id)
  }, [currentChat, branchForNewChat, startNewChat, session])

  // Branch and send a message to the new chat (Option+Enter)
  // The new chat starts in the background - we stay on the current chat
  const handleBranchWithMessage = useCallback(async (message: string, agent: string, model: string) => {
    if (!branchForNewChat || currentChat?.repo === NEW_REPOSITORY) return
    if (!session) {
      savePendingMessage({ message, agent, model })
      setSignInModalOpen(true)
      return
    }
    // Create new chat in "creating" state without switching to it (spinner shows immediately)
    const chatId = await startNewChat(currentChat.repo, branchForNewChat, currentChat.id, false, "creating")
    if (!chatId) return
    // Send message to the new chat (it runs in background)
    sendMessage(message, agent, model, undefined, chatId)
  }, [currentChat, branchForNewChat, startNewChat, sendMessage, session])

  // Branch a queued message to a new chat (removes from queue)
  // The new chat starts in the background - we stay on the current chat
  const handleBranchQueuedMessage = useCallback(async (id: string, message: string, agent?: string, model?: string) => {
    if (!branchForNewChat || currentChat?.repo === NEW_REPOSITORY) return
    if (!session) {
      setSignInModalOpen(true)
      return
    }
    // Remove from queue first
    removeQueuedMessage(id)
    // Create new chat in "creating" state without switching to it (spinner shows immediately)
    const chatId = await startNewChat(currentChat.repo, branchForNewChat, currentChat.id, false, "creating")
    if (!chatId) return
    // Send message to the new chat (it runs in background)
    sendMessage(message, agent, model, undefined, chatId)
  }, [currentChat, branchForNewChat, startNewChat, sendMessage, removeQueuedMessage, session])

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
      case "download":
        handleDownloadProject()
        break
    }
  }, [gitDialogs, handleBranchChat, handleDownloadProject])

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
      if (repoFilter === ALL_REPOSITORIES) return true
      if (repoFilter === NO_REPOSITORY) return c.repo === NEW_REPOSITORY
      return c.repo === repoFilter
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
  }, [chats, repoFilter])

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
    expandChatAndAncestors(nextId, byId)
    handleSelectChat(nextId)
  }, [treeOrderedChatIds, currentChatId, chats, expandChatAndAncestors])

  // Open the current chat's branch on GitHub (available once the branch is pushed).
  const githubBranchUrl =
    currentChat?.branch && currentChat.sandboxId && currentChat.repo !== NEW_REPOSITORY
      ? `https://github.com/${currentChat.repo}/tree/${currentChat.branch}`
      : null
  const handleOpenInGitHub = useCallback(() => {
    if (githubBranchUrl) window.open(githubBranchUrl, "_blank", "noopener,noreferrer")
  }, [githubBranchUrl])

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

  // For unauthenticated users with no real chat, render a synthetic "draft"
  // chat so the prompt bar and dropdowns are interactive. The draft never
  // talks to the server; on submit we save a pending-message blob to
  // sessionStorage, prompt sign-in, and replay it once the user is signed in.
  //
  // The draft chat's id is a real-format nanoid generated once per page
  // load (not a magic-string sentinel) — it's only used for ChatPanel's
  // internal keying and is never sent to the server. "Draft mode" is
  // detected by the existence of `draftChat`, not by id comparison.
  const draftIdRef = useRef<string>(`draft-${nanoid()}`)
  const draftChat: Chat | null = useMemo(() => {
    if (!isHydrated || session || currentChatId) return null
    const resolvedAgent = (draftAgent ?? settings.defaultAgent ?? getDefaultAgent(credentialFlags)) as Agent
    const resolvedModel = draftModel ?? settings.defaultModel ?? getDefaultModelForAgent(resolvedAgent, credentialFlags)
    return {
      id: draftIdRef.current,
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
  }, [isHydrated, session, currentChatId, draftAgent, draftModel, settings.defaultAgent, settings.defaultModel, credentialFlags])

  const isDraftMode = !!draftChat
  const displayCurrentChat = isHydrated ? (currentChat ?? draftChat) : null

  // When in draft mode, agent/model dropdowns route to local draft state
  // because no real chat row exists to PATCH yet.
  const handleUpdateChatProp = useCallback(
    (updates: Partial<Chat>) => {
      if (isDraftMode) {
        if (updates.agent !== undefined) setDraftAgent(updates.agent)
        if (updates.model !== undefined) setDraftModel(updates.model)
        // Other fields (repo, branch, etc.) are ignored — those pickers
        // already prompt sign-in before they could fire onUpdateChat.
        return
      }
      updateCurrentChat(updates)
    },
    [isDraftMode, updateCurrentChat]
  )

  return (
    <PaletteProvider
      repos={repos}
      currentRepo={currentChat?.repo !== NEW_REPOSITORY ? currentChat?.repo ?? null : null}
      branches={branches}
      chats={displayChats.map((c) => ({ id: c.id, displayName: c.displayName, repo: c.repo }))}
      onSelectRepo={handlePaletteSelectRepo}
      onSelectBranch={handlePaletteSelectBranch}
      onRunCommand={handleRunCommand}
      onNewChat={handleNewChat}
      onBranchChat={canBranch ? handleBranchChat : undefined}
      onCreateRepo={currentChat?.repo === NEW_REPOSITORY ? handleCreateRepo : undefined}
      showGitCommands={!!currentChat && currentChat.repo !== NEW_REPOSITORY}
      onOpenInGitHub={githubBranchUrl ? handleOpenInGitHub : undefined}
      onOpenSettings={() => handleOpenSettings()}
      onToggleSidebar={!isMobile ? () => setSidebarCollapsed((v) => !v) : undefined}
      onSignIn={!session ? () => signIn("github") : undefined}
      onSignOut={session ? () => {
            clearAllStorage()
            signOut()
          } : undefined}
      onDeleteChat={displayCurrentChatId ? () => setDeleteConfirmChatId(displayCurrentChatId) : undefined}
      onOpenInVSCode={currentChat?.sandboxId ? handleOpenInVSCode : undefined}
      onOpenTerminal={
        currentChat?.sandboxId
          ? () => openPreview({ type: "terminal", id: currentChat.sandboxId! })
          : undefined
      }
      servers={availableServers}
      onOpenServer={(port, url) => openPreview({ type: "server", port, url })}
      onClosePreview={previewOpen ? closePreview : undefined}
      chatIds={displayChats.map((c) => c.id)}
      onNavigateChat={handleNavigateChat}
      currentChatId={displayCurrentChatId}
      onSelectChat={handleSelectChat}
    >
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
          onDeleteChat={removeChat}
          onRenameChat={renameChat}
          onOpenSettings={() => handleOpenSettings()}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          onOpenHelp={() => setHelpOpen(true)}
          isMobile={false}
          repoFilter={repoFilter}
          onRepoFilterChange={setRepoFilter}
          collapsedChatIds={collapsedChatIds}
          onToggleChatCollapsed={toggleChatCollapsed}
          onRequestMergeChats={handleRequestMergeChats}
          onRequestRebaseChat={handleRequestRebaseChat}
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
          onDeleteChat={removeChat}
          onRenameChat={renameChat}
          onOpenSettings={() => handleOpenSettings()}
          collapsed={false}
          onToggleCollapse={() => {}}
          width={280}
          onWidthChange={() => {}}
          onOpenHelp={() => setHelpOpen(true)}
          isMobile={true}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          repoFilter={repoFilter}
          onRepoFilterChange={setRepoFilter}
          collapsedChatIds={collapsedChatIds}
          onToggleChatCollapsed={toggleChatCollapsed}
          onRequestMergeChats={handleRequestMergeChats}
          onRequestRebaseChat={handleRequestRebaseChat}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        {isMobile && (
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background pt-safe">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-2 -ml-2 rounded-lg hover:bg-accent active:bg-accent text-foreground transition-colors touch-target"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="text-base font-semibold truncate flex-1">
              {displayCurrentChat?.displayName || "Background Agents"}
            </h1>
            <button
              onClick={() => setMobileCommandsOpen(true)}
              className="p-2 -mr-2 rounded-lg hover:bg-accent active:bg-accent text-foreground transition-colors touch-target"
              aria-label="Commands"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </div>
        )}

        <div className="flex-1 flex min-h-0">
            <div className="flex-1 flex flex-col min-w-0">
              <ChatPanel
                chat={displayCurrentChat}
                settings={settings}
                credentialFlags={credentialFlags}
                onSendMessage={handleSendMessage}
                onEnqueueMessage={enqueueMessage}
                onRemoveQueuedMessage={removeQueuedMessage}
                onResumeQueue={resumeQueue}
                onStopAgent={stopAgent}
                onChangeRepo={handleChangeRepo}
                onChangeBranch={handleChangeBranch}
                onUpdateChat={handleUpdateChatProp}
                onOpenSettings={handleOpenSettings}
                onSlashCommand={handleSlashCommand}
                onRequireSignIn={!session ? () => setSignInModalOpen(true) : undefined}
                onDeleteChat={displayCurrentChatId ? () => removeChat(displayCurrentChatId) : undefined}
                onOpenHelp={() => setHelpOpen(true)}
                onOpenFile={(filePath) => {
                  const filename = filePath.split("/").pop() || filePath
                  openPreview({ type: "file", filePath, filename })
                }}
                onForcePush={() => gitDialogs.setForcePushOpen(true)}
                isMobile={isMobile}
                rebaseConflict={gitDialogs.rebaseConflict}
                onAbortConflict={gitDialogs.handleAbortConflict}
                conflictActionLoading={gitDialogs.actionLoading}
                onBranchWithMessage={handleBranchWithMessage}
                onBranchQueuedMessage={handleBranchQueuedMessage}
                canBranch={canBranch}
                isLoadingMessages={isLoadingMessages}
              />
            </div>
            {!isMobile && previewOpen && (
              <>
                <div
                  onMouseDown={startPreviewResize}
                  className="group flex-shrink-0 w-1 cursor-col-resize relative"
                  aria-label="Resize preview"
                  role="separator"
                >
                  <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border/60 group-hover:bg-border group-active:bg-primary transition-colors" />
                </div>
                <PreviewView
                  style={{ width: previewWidth }}
                  className="flex-shrink-0"
                  item={previewItem}
                  sandboxId={currentChat?.sandboxId ?? null}
                  repo={currentChat?.repo && currentChat.repo !== NEW_REPOSITORY ? currentChat.repo : null}
                  branch={currentChat?.branch ?? currentChat?.baseBranch ?? null}
                  onClose={closePreview}
                />
              </>
            )}
          </div>
      </div>

      {/* Transparent full-screen shield during split drag so the cursor isn't
          swallowed by iframes or other child elements. */}
      {isResizingPreview && (
        <div className="fixed inset-0 z-[999] cursor-col-resize" />
      )}

      <RepoPickerModal
        open={repoSelectOpen}
        onClose={() => setRepoSelectOpen(false)}
        onSelect={handleRepoSelect}
        isMobile={isMobile}
        mode="select"
        onRequestCreate={() => setRepoCreateOpen(true)}
      />

      <RepoPickerModal
        open={repoCreateOpen}
        onClose={() => setRepoCreateOpen(false)}
        onSelect={handleRepoSelect}
        isMobile={isMobile}
        mode="create"
        suggestedName={currentChat?.displayName ?? null}
      />

      <BranchPickerModal
        open={branchSelectOpen}
        onClose={() => setBranchSelectOpen(false)}
        onSelect={async (branch) => {
          if (currentChat && currentChat.messages.length === 0 && !currentChat.sandboxId) {
            // For new chats, update baseBranch (the branch we'll branch from)
            updateCurrentChat({ baseBranch: branch })
          } else if (currentChat) {
            const chatId = await startNewChat(currentChat.repo, branch)
            if (chatId) selectChat(chatId)
          }
          setBranchSelectOpen(false)
        }}
        repo={currentChat?.repo?.split("/")[1] || ""}
        owner={currentChat?.repo?.split("/")[0] || ""}
        selectedBranch={currentChat?.baseBranch}
        isMobile={isMobile}
      />

        <SettingsModal
          open={settingsOpen}
          onClose={handleCloseSettings}
          settings={settings}
          credentialFlags={credentialFlags}
          onSave={updateSettings}
          highlightKey={settingsHighlightKey}
          isMobile={isMobile}
        />

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
        open={signInModalOpen}
        onClose={() => setSignInModalOpen(false)}
        isMobile={isMobile}
      />

      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        isMobile={isMobile}
      />

      {/* Mobile Commands Menu */}
      {isMobile && (
        <MobileCommandsMenu
          open={mobileCommandsOpen}
          onClose={() => setMobileCommandsOpen(false)}
          onSlashCommand={handleSlashCommand}
          onOpenHelp={() => setHelpOpen(true)}
          onOpenGitHub={githubBranchUrl ? handleOpenInGitHub : undefined}
          hasLinkedRepo={!!(currentChat && currentChat.repo !== NEW_REPOSITORY)}
          inConflict={!!(gitDialogs.rebaseConflict?.inRebase || gitDialogs.rebaseConflict?.inMerge)}
          hasGitHubLink={!!githubBranchUrl}
        />
      )}

      <ConfirmDialog
        open={deleteConfirmChatId !== null}
        onClose={() => setDeleteConfirmChatId(null)}
        onConfirm={() => {
          if (deleteConfirmChatId) removeChat(deleteConfirmChatId)
        }}
        title="Delete chat"
        description={
          <>
            Delete{" "}
            <span className="font-medium text-foreground">
              {chats.find((c) => c.id === deleteConfirmChatId)?.displayName || "this chat"}
            </span>
            ? This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isMobile={isMobile}
      />
    </div>
    </PaletteProvider>
  )
}
