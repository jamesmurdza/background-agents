"use client"

import { useState, useEffect } from "react"
import { useSession, signIn } from "next-auth/react"
import { Menu } from "lucide-react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { SDKContent } from "@/components/SDKContent"
import { RepoPickerModal } from "@/components/modals/RepoPickerModal"
import { SettingsModal, type HighlightKey } from "@/components/modals/SettingsModal"
import { useChat } from "@/lib/hooks/useChat"
import { useMobile } from "@/lib/hooks/useMobile"
import { NEW_REPOSITORY } from "@/lib/types"

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
    updateChatRepo,
    updateCurrentChat,
    sendMessage,
    stopAgent,
    updateSettings,
  } = useChat()

  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsHighlightKey, setSettingsHighlightKey] = useState<HighlightKey>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState<"chat" | "sdk">(() => {
    if (typeof window === "undefined") return "chat"
    return window.location.pathname === "/sdk" ? "sdk" : "chat"
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

  // Handler for new chat - creates with NEW_REPOSITORY by default
  const handleNewChat = () => {
    startNewChat()
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
  const handleRepoSelect = (repo: string, branch: string) => {
    if (currentChatId) {
      updateChatRepo(currentChatId, repo, branch)
    }
  }

  // Handler for sending message
  const handleSendMessage = (message: string, agent: string, model: string) => {
    // For GitHub repos, we need auth
    if (currentChat && currentChat.repo !== NEW_REPOSITORY && !session) {
      signIn("github")
      return
    }
    sendMessage(message, agent, model)
  }

  // Don't render chats until hydrated to avoid SSR mismatch
  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null
  const displayCurrentChat = isHydrated ? currentChat : null

  return (
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
          onOpenSettings={() => handleOpenSettings()}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
          currentPage={currentPage}
          onNavigate={handleNavigate}
          isMobile={false}
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
      />

      <SettingsModal
        open={settingsOpen}
        onClose={handleCloseSettings}
        settings={settings}
        onSave={updateSettings}
        highlightKey={settingsHighlightKey}
        isMobile={isMobile}
      />
    </div>
  )
}
