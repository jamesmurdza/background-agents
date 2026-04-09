"use client"

import { useState, useEffect } from "react"
import { useSession, signIn } from "next-auth/react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { RepoPickerModal } from "@/components/modals/RepoPickerModal"
import { SettingsModal } from "@/components/modals/SettingsModal"
import { useChat } from "@/lib/hooks/useChat"
import { NEW_REPOSITORY } from "@/lib/types"

export default function HomePage() {
  const { data: session } = useSession()

  const {
    chats,
    currentChat,
    currentChatId,
    settings,
    isHydrated,
    deletingChatIds,
    canCreateChat,
    startNewChat,
    selectChat,
    removeChat,
    updateChatRepo,
    sendMessage,
    stopAgent,
    updateSettings,
  } = useChat()

  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(260)

  // Auto-create a new chat if none exists after hydration
  useEffect(() => {
    if (isHydrated && !currentChatId) {
      startNewChat()
    }
  }, [isHydrated, currentChatId, startNewChat])

  // Handler for new chat - creates with NEW_REPOSITORY by default
  const handleNewChat = () => {
    startNewChat() // Defaults to NEW_REPOSITORY
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
  const handleSendMessage = (message: string) => {
    // For GitHub repos, we need auth
    if (currentChat && currentChat.repo !== NEW_REPOSITORY && !session) {
      signIn("github")
      return
    }
    sendMessage(message)
  }

  // Don't render chats until hydrated to avoid SSR mismatch
  const displayChats = isHydrated ? chats : []
  const displayCurrentChatId = isHydrated ? currentChatId : null
  const displayCurrentChat = isHydrated ? currentChat : null

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        chats={displayChats}
        currentChatId={displayCurrentChatId}
        deletingChatIds={deletingChatIds}
        canCreateChat={canCreateChat}
        onSelectChat={selectChat}
        onNewChat={handleNewChat}
        onDeleteChat={removeChat}
        onOpenSettings={() => setSettingsOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
      />

      <ChatPanel
        chat={displayCurrentChat}
        onSendMessage={handleSendMessage}
        onStopAgent={stopAgent}
        onChangeRepo={handleChangeRepo}
      />

      <RepoPickerModal
        open={repoPickerOpen}
        onClose={() => setRepoPickerOpen(false)}
        onSelect={handleRepoSelect}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSave={updateSettings}
      />
    </div>
  )
}
