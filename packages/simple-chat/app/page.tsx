"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession, signIn } from "next-auth/react"
import { Menu } from "lucide-react"
import { Sidebar, ALL_REPOSITORIES, NO_REPOSITORY } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { SDKContent } from "@/components/SDKContent"
import { RepoPickerModal } from "@/components/modals/RepoPickerModal"
import { SettingsModal, type HighlightKey } from "@/components/modals/SettingsModal"
import { SignInModal } from "@/components/modals/SignInModal"
import { MergeDialog, RebaseDialog, PRDialog, useGitDialogs } from "@/components/modals/GitDialogs"
import type { SlashCommandType } from "@/components/SlashCommandMenu"
import { PaletteProvider } from "@/components/search-palette"
import { useChat } from "@/lib/hooks/useChat"
import { useMobile } from "@/lib/hooks/useMobile"
import { NEW_REPOSITORY, type Message } from "@/lib/types"
import { fetchRepos, fetchBranches, type GitHubRepo, type GitHubBranch } from "@/lib/github"

// Type for pending message data stored before sign-in
interface PendingMessage {
  message: string
  agent: string
  model: string
  files?: File[]
}

export default function HomePage() {
  const { data: session } = useSession()
  const isMobile = useMobile()

  const {
    chats,
    currentChat,
    currentChatId,
    settings,
    isHydrated,
    deletingChatIds,
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
  } = useChat()

  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsHighlightKey, setSettingsHighlightKey] = useState<HighlightKey>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [signInModalOpen, setSignInModalOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState<"chat" | "sdk">(() => {
    if (typeof window === "undefined") return "chat"
    return window.location.pathname === "/sdk" ? "sdk" : "chat"
  })

  // Store pending message data when user tries to send without being signed in
  const pendingMessageRef = useRef<PendingMessage | null>(null)

  // Repos and branches for search palette
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [branches, setBranches] = useState<GitHubBranch[]>([])

  // Repository filter state (shared with Sidebar)
  const [repoFilter, setRepoFilter] = useState<string>(ALL_REPOSITORIES)

  // Load repos when authenticated
  useEffect(() => {
    if (session?.accessToken) {
      fetchRepos(session.accessToken).then(setRepos).catch(console.error)
    }
  }, [session?.accessToken])

  // Load branches when current chat has a repo
  useEffect(() => {
    if (session?.accessToken && currentChat?.repo && currentChat.repo !== NEW_REPOSITORY) {
      const [owner, name] = currentChat.repo.split("/")
      if (owner && name) {
        fetchBranches(session.accessToken, owner, name).then(setBranches).catch(console.error)
      }
    } else {
      setBranches([])
    }
  }, [session?.accessToken, currentChat?.repo])

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
  })

  // Close mobile sidebar when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      setMobileSidebarOpen(false)
    }
  }, [isMobile])

  // Navigate between pages without reload
  const handleNavigate = (page: "chat" | "sdk") => {
    setCurrentPage(page)
    window.history.pushState(null, "", page === "sdk" ? "/sdk" : "/")
  }

  // Handle browser back/forward
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPage(window.location.pathname === "/sdk" ? "sdk" : "chat")
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

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

  // Auto-create a new chat if none exists after hydration
  useEffect(() => {
    if (isHydrated && !currentChatId) {
      startNewChat()
    }
  }, [isHydrated, currentChatId, startNewChat])

  // Handler for new chat - uses selected repo filter as default, or NEW_REPOSITORY if "All" is selected
  const handleNewChat = () => {
    // If a specific repo is selected in the filter, use it for the new chat
    if (repoFilter !== ALL_REPOSITORIES && repoFilter !== NO_REPOSITORY) {
      // Find the repo to get the default branch
      const repo = repos.find(r => `${r.owner.login}/${r.name}` === repoFilter)
      startNewChat(repoFilter, repo?.default_branch ?? "main")
    } else {
      // Default to NEW_REPOSITORY (no repo)
      startNewChat()
    }
    if (currentPage !== "chat") handleNavigate("chat")
  }

  // Handler for selecting a chat - switch to chat view
  const handleSelectChat = (chatId: string) => {
    selectChat(chatId)
    if (currentPage !== "chat") handleNavigate("chat")
  }

  // Handler for changing repo (called from ChatPanel header)
  const handleChangeRepo = () => {
    // Must be signed in to access GitHub repos
    if (!session) {
      signIn("github")
      return
    }
    setRepoPickerOpen(true)
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
      // Store the pending message and show sign-in modal
      pendingMessageRef.current = { message, agent, model, files }
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

  // Effect to send pending message after sign-in
  useEffect(() => {
    if (session && pendingMessageRef.current) {
      const { message, agent, model, files } = pendingMessageRef.current
      pendingMessageRef.current = null
      setSignInModalOpen(false)

      // Small delay to ensure state is updated
      setTimeout(() => {
        sendMessage(message, agent, model, files)
      }, 100)
    }
  }, [session, sendMessage])

  // Handler for slash commands - open the corresponding git dialog
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
    }
  }, [gitDialogs])

  // Palette handlers
  const handlePaletteSelectRepo = useCallback((repo: GitHubRepo) => {
    // Create a new chat with this repo
    const chatId = startNewChat(`${repo.owner.login}/${repo.name}`, repo.default_branch)
    if (currentPage !== "chat") handleNavigate("chat")
  }, [startNewChat, currentPage])

  const handlePaletteSelectBranch = useCallback((repo: GitHubRepo, branch: GitHubBranch) => {
    // Create a new chat with this repo and branch
    const chatId = startNewChat(`${repo.owner.login}/${repo.name}`, branch.name)
    if (currentPage !== "chat") handleNavigate("chat")
  }, [startNewChat, currentPage])

  // Command palette handler (wraps handleSlashCommand to accept string)
  const handleRunCommand = useCallback((command: string) => {
    handleSlashCommand(command as SlashCommandType)
  }, [handleSlashCommand])

  // Don't render chats until hydrated to avoid SSR mismatch
  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null
  const displayCurrentChat = isHydrated ? currentChat : null

  return (
    <PaletteProvider
      repos={repos}
      currentRepo={currentChat?.repo !== NEW_REPOSITORY ? currentChat?.repo ?? null : null}
      branches={branches}
      chats={displayChats.map((c) => ({ id: c.id, displayName: c.displayName, repo: c.repo }))}
      onSelectRepo={handlePaletteSelectRepo}
      onSelectBranch={handlePaletteSelectBranch}
      onRunCommand={handleRunCommand}
      chatIds={displayChats.map((c) => c.id)}
      currentChatId={displayCurrentChatId}
      onSelectChat={handleSelectChat}
    >
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      {!isMobile && (
        <Sidebar
          chats={displayChats}
          currentChatId={currentPage === "chat" ? displayCurrentChatId : null}
          deletingChatIds={deletingChatIds}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={removeChat}
          onRenameChat={renameChat}
          onOpenSettings={() => handleOpenSettings()}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          isMobile={false}
          repoFilter={repoFilter}
          onRepoFilterChange={setRepoFilter}
        />
      )}

      {/* Mobile Sidebar (Drawer) */}
      {isMobile && (
        <Sidebar
          chats={displayChats}
          currentChatId={currentPage === "chat" ? displayCurrentChatId : null}
          deletingChatIds={deletingChatIds}
          onSelectChat={handleSelectChat}
          onNewChat={handleNewChat}
          onDeleteChat={removeChat}
          onRenameChat={renameChat}
          onOpenSettings={() => handleOpenSettings()}
          collapsed={false}
          onToggleCollapse={() => {}}
          width={280}
          onWidthChange={() => {}}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          isMobile={true}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
          repoFilter={repoFilter}
          onRepoFilterChange={setRepoFilter}
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
              {currentPage === "sdk"
                ? "API Reference"
                : displayCurrentChat?.displayName || "Background Agents"
              }
            </h1>
          </div>
        )}

        {currentPage === "chat" ? (
          <ChatPanel
            chat={displayCurrentChat}
            settings={settings}
            onSendMessage={handleSendMessage}
            onStopAgent={stopAgent}
            onChangeRepo={handleChangeRepo}
            onUpdateChat={updateCurrentChat}
            onOpenSettings={handleOpenSettings}
            onSlashCommand={handleSlashCommand}
            isMobile={isMobile}
          />
        ) : (
          <SDKContent isMobile={isMobile} />
        )}
      </div>

      <RepoPickerModal
        open={repoPickerOpen}
        onClose={() => setRepoPickerOpen(false)}
        onSelect={handleRepoSelect}
        isMobile={isMobile}
        allowSelect={currentChat?.messages.length === 0 && !currentChat?.sandboxId}
        allowCreate={currentChat?.repo === NEW_REPOSITORY}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={handleCloseSettings}
        settings={settings}
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

      {/* Sign In Modal - shown when user tries to send message without being signed in */}
      <SignInModal
        open={signInModalOpen}
        onClose={() => setSignInModalOpen(false)}
        isMobile={isMobile}
      />
    </div>
    </PaletteProvider>
  )
}
