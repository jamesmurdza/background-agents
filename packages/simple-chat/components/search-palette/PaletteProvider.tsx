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
  // For Alt+Up/Down chat navigation
  chatIds: string[]
  currentChatId: string | null
  onSelectChat: (chatId: string) => void
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
  chatIds,
  currentChatId,
  onSelectChat,
}: PaletteProviderProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const openCommand = useCallback(() => setCommandOpen(true), [])

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
        setSearchOpen(true)
        return
      }

      // Cmd/Ctrl + K for commands (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setCommandOpen(true)
        return
      }

      // Alt + Up/Down for chat navigation (only when not in input)
      if (!isInInput && e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
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
  }, [chatIds, currentChatIndex, onSelectChat])

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
      />
    </PaletteContext.Provider>
  )
}
