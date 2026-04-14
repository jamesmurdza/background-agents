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
  onSelectRepo: (repoId: string) => void
  onSelectBranch: (repoId: string, branchId: string) => void
  onRunCommand: (command: string) => void
}

export function PaletteProvider({
  children,
  repos,
  activeRepoId,
  onSelectRepo,
  onSelectBranch,
  onRunCommand,
}: PaletteProviderProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const openCommand = useCallback(() => setCommandOpen(true), [])

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
      }

      // Cmd/Ctrl + K for commands
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setCommandOpen(true)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

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
