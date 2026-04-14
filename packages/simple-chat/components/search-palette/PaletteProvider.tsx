"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { SearchPalette } from "./SearchPalette"
import { CommandPalette } from "./CommandPalette"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"

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
      // Don't trigger if user is typing in an input
      const target = e.target as HTMLElement
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return
      }

      // Cmd/Ctrl + P for search
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      // Cmd/Ctrl + K for commands
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setCommandOpen(true)
        return
      }

      // Alt + Up/Down for chat navigation
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (chatIds.length === 0) return
        e.preventDefault()

        let newIndex: number
        if (e.key === "ArrowUp") {
          // Go to previous chat (or wrap to last)
          newIndex = currentChatIndex <= 0 ? chatIds.length - 1 : currentChatIndex - 1
        } else {
          // Go to next chat (or wrap to first)
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
        onSelectRepo={onSelectRepo}
        onSelectBranch={onSelectBranch}
      />
      <CommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onRunCommand={onRunCommand}
      />
    </PaletteContext.Provider>
  )
}
