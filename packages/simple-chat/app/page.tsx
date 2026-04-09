"use client"

import { useState } from "react"
import { useSession, signIn } from "next-auth/react"
import { Sidebar } from "@/components/Sidebar"
import { ChatPanel } from "@/components/ChatPanel"
import { RepoPickerModal } from "@/components/modals/RepoPickerModal"
import { SettingsModal } from "@/components/modals/SettingsModal"
import { useChat } from "@/lib/hooks/useChat"
import { Loader2 } from "lucide-react"

export default function HomePage() {
  const { data: session, status } = useSession()

  const {
    chats,
    currentChat,
    currentChatId,
    settings,
    startNewChat,
    selectChat,
    removeChat,
    sendMessage,
    stopAgent,
    updateSettings,
  } = useChat()

  const [repoPickerOpen, setRepoPickerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // Loading state
  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Not authenticated - show sign in prompt
  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-semibold mb-4">Simple Chat</h1>
          <p className="text-muted-foreground mb-6">
            A simple interface for AI coding agents. Sign in with GitHub to get started.
          </p>
          <button
            onClick={() => signIn("github")}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <GitHubIcon className="h-5 w-5" />
            Sign in with GitHub
          </button>
        </div>
      </div>
    )
  }

  // Handler for new chat
  const handleNewChat = () => {
    // Check if API key is configured
    if (!settings.anthropicApiKey) {
      setSettingsOpen(true)
      return
    }
    setRepoPickerOpen(true)
  }

  // Handler for repo selection
  const handleRepoSelect = (repo: string, branch: string) => {
    startNewChat(repo, branch)
  }

  // Handler for sending message
  const handleSendMessage = (message: string) => {
    // Check if API key is configured
    if (!settings.anthropicApiKey) {
      setSettingsOpen(true)
      return
    }
    sendMessage(message)
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        chats={chats}
        currentChatId={currentChatId}
        onSelectChat={selectChat}
        onNewChat={handleNewChat}
        onDeleteChat={removeChat}
        onOpenSettings={() => setSettingsOpen(true)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      <ChatPanel
        chat={currentChat}
        onSendMessage={handleSendMessage}
        onStopAgent={stopAgent}
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

// GitHub Icon component
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  )
}
