"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { SearchPalette } from "./SearchPalette"
import { CommandPalette } from "./CommandPalette"
import type { Repo } from "@/lib/shared/types"

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
  repos: Repo[]
  activeRepoId: string | null
  activeBranchId: string | null
  onSelectRepo: (repoId: string) => void
  onSelectBranch: (repoId: string, branchId: string) => void
  onRunCommand: (command: string) => void
}

export function PaletteProvider({
  children,
  repos,
  activeRepoId,
  activeBranchId,
  onSelectRepo,
  onSelectBranch,
  onRunCommand,
}: PaletteProviderProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const openCommand = useCallback(() => setCommandOpen(true), [])

  // Get current repo's branches for Alt+Up/Down navigation
  const activeRepo = repos.find((r) => r.id === activeRepoId)
  const branches = activeRepo?.branches ?? []
  const currentBranchIndex = branches.findIndex((b) => b.id === activeBranchId)

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

      // Alt + Up/Down for branch navigation
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (!activeRepoId || branches.length === 0) return
        e.preventDefault()

        let newIndex: number
        if (e.key === "ArrowUp") {
          // Go to previous branch (or wrap to last)
          newIndex = currentBranchIndex <= 0 ? branches.length - 1 : currentBranchIndex - 1
        } else {
          // Go to next branch (or wrap to first)
          newIndex = currentBranchIndex >= branches.length - 1 ? 0 : currentBranchIndex + 1
        }

        const newBranch = branches[newIndex]
        if (newBranch) {
          onSelectBranch(activeRepoId, newBranch.id)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeRepoId, branches, currentBranchIndex, onSelectBranch])

  return (
    <PaletteContext.Provider value={{ openSearch, openCommand }}>
      {children}
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        repos={repos}
        activeRepoId={activeRepoId}
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
