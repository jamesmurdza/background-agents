"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { SearchPalette } from "./SearchPalette"
import { CommandPalette } from "./CommandPalette"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"

interface Chat {
  id: string
  displayName: string | null
  repo: string
}

interface PaletteContextValue {
  openSearch: () => void
  openCommand: () => void
}

const PaletteContext = createContext<PaletteContextValue | null>(null)

export function usePalette() {
  const context = useContext(PaletteContext)
  if (!context) {
    throw new Error("usePalette must be used within PaletteProvider")
  }
  return context
}

interface PaletteProviderProps {
  children: ReactNode
  repos: GitHubRepo[]
  currentRepo: string | null
  branches: GitHubBranch[]
  chats: Chat[]
  onSelectRepo: (repo: GitHubRepo) => void
  onSelectBranch: (repo: GitHubRepo, branch: GitHubBranch) => void
  onRunCommand: (command: string) => void
  onNewChat: () => void
  onBranchChat?: () => void
  onCreateRepo?: () => void
  showGitCommands?: boolean
  onOpenInGitHub?: () => void
  onOpenSettings: () => void
  onToggleSidebar?: () => void
  onSignIn?: () => void
  onSignOut?: () => void
  onDeleteChat?: () => void
  onOpenInVSCode?: () => void
  onOpenTerminal?: () => void
  servers?: Array<{ port: number; url: string }>
  onOpenServer?: (port: number, url: string) => void
  onClosePreview?: () => void
  onDownloadProject?: () => void
  isDownloading?: boolean
  onCopyCloneCommand?: () => void
  onCopyCheckoutCommand?: () => void
  // For Alt+Up/Down chat navigation
  chatIds: string[]
  currentChatId: string | null
  onSelectChat: (chatId: string) => void
  /** Called with a direction for Alt+Up / Alt+Down. When provided it takes
   *  precedence over the flat chatIds rotation so the parent can walk the
   *  sidebar tree and auto-expand branches. */
  onNavigateChat?: (direction: "up" | "down") => void
}

export function PaletteProvider({
  children,
  repos,
  currentRepo,
  branches,
  chats,
  onSelectRepo,
  onSelectBranch,
  onRunCommand,
  onNewChat,
  onBranchChat,
  onCreateRepo,
  showGitCommands,
  onOpenInGitHub,
  onOpenSettings,
  onToggleSidebar,
  onSignIn,
  onSignOut,
  onDeleteChat,
  onOpenInVSCode,
  onOpenTerminal,
  servers,
  onOpenServer,
  onClosePreview,
  onDownloadProject,
  isDownloading,
  onCopyCloneCommand,
  onCopyCheckoutCommand,
  chatIds,
  currentChatId,
  onSelectChat,
  onNavigateChat,
}: PaletteProviderProps) {
  const [searchOpen, setSearchOpenState] = useState(false)
  const [commandOpen, setCommandOpenState] = useState(false)

  // Exclusive: opening one closes the other. Closing either returns focus to
  // the chat prompt so the user can start typing right away.
  const focusPrompt = useCallback(() => {
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>("[data-chat-prompt]")
      el?.focus()
    }, 0)
  }, [])
  const setSearchOpen = useCallback((open: boolean) => {
    setSearchOpenState(open)
    if (open) setCommandOpenState(false)
    else focusPrompt()
  }, [focusPrompt])
  const setCommandOpen = useCallback((open: boolean) => {
    setCommandOpenState(open)
    if (open) setSearchOpenState(false)
    else focusPrompt()
  }, [focusPrompt])

  const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen])
  const openCommand = useCallback(() => setCommandOpen(true), [setCommandOpen])

  // Find current chat index for Alt+Up/Down navigation
  const currentChatIndex = chatIds.findIndex((id) => id === currentChatId)

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable

      // Cmd/Ctrl + P for search (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        openSearch()
        return
      }

      // Cmd/Ctrl + K for commands (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        openCommand()
        return
      }

      // Alt + Up/Down for chat navigation (works even in inputs)
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (onNavigateChat) {
          e.preventDefault()
          onNavigateChat(e.key === "ArrowUp" ? "up" : "down")
          return
        }
        if (chatIds.length === 0) return
        e.preventDefault()

        let newIndex: number
        if (e.key === "ArrowUp") {
          newIndex = currentChatIndex <= 0 ? chatIds.length - 1 : currentChatIndex - 1
        } else {
          newIndex = currentChatIndex >= chatIds.length - 1 ? 0 : currentChatIndex + 1
        }

        const newChatId = chatIds[newIndex]
        if (newChatId) {
          onSelectChat(newChatId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [chatIds, currentChatIndex, onSelectChat, openSearch, openCommand, onNavigateChat])

  return (
    <PaletteContext.Provider value={{ openSearch, openCommand }}>
      {children}
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        repos={repos}
        currentRepo={currentRepo}
        branches={branches}
        chats={chats}
        onSelectRepo={onSelectRepo}
        onSelectBranch={onSelectBranch}
        onSelectChat={onSelectChat}
      />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onRunCommand={onRunCommand}
        onNewChat={onNewChat}
        onBranchChat={onBranchChat}
        onCreateRepo={onCreateRepo}
        showGitCommands={showGitCommands}
        onOpenInGitHub={onOpenInGitHub}
        onOpenSettings={onOpenSettings}
        onToggleSidebar={onToggleSidebar}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onDeleteChat={onDeleteChat}
        onOpenInVSCode={onOpenInVSCode}
        onOpenTerminal={onOpenTerminal}
        servers={servers}
        onOpenServer={onOpenServer}
        onClosePreview={onClosePreview}
        onDownloadProject={onDownloadProject}
        isDownloading={isDownloading}
        onCopyCloneCommand={onCopyCloneCommand}
        onCopyCheckoutCommand={onCopyCheckoutCommand}
      />
    </PaletteContext.Provider>
  )
}
