"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { useTheme } from "next-themes"
import { SearchPalette } from "./SearchPalette"
import { TriggersModal } from "./TriggersModal"
import { CommandPalette } from "./CommandPalette"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import type { Theme } from "@/lib/types"
import type { PaletteChat, PaletteCommandCallbacks } from "./types"
import { isModKeyPressed } from "@/lib/keyboard"

interface PaletteContextValue {
  openSearch: () => void
  openCommand: () => void
  openJobsSearch: () => void
}

const PaletteContext = createContext<PaletteContextValue | null>(null)

export function usePalette() {
  const context = useContext(PaletteContext)
  if (!context) {
    throw new Error("usePalette must be used within PaletteProvider")
  }
  return context
}

interface PaletteProviderProps extends PaletteCommandCallbacks {
  children: ReactNode
  repos: GitHubRepo[]
  currentRepo: string | null
  branches: GitHubBranch[]
  chats: PaletteChat[]
  /** Repositories shown in the sidebar's repository selector. */
  sidebarRepos: string[]
  onSelectRepo: (repo: GitHubRepo) => void
  onSelectBranch: (repo: GitHubRepo, branch: GitHubBranch) => void
  /** Select a repository in the sidebar (sets the repo filter) — no new chat. */
  onFilterRepo: (repo: string) => void
  /** Toggle the integrated terminal (Cmd/Ctrl+J). Provider-only. */
  onToggleTerminal?: () => void
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
  sidebarRepos,
  onSelectRepo,
  onSelectBranch,
  onFilterRepo,
  onRunCommand,
  onNewChat,
  onBranchChat,
  onCreateRepo,
  showGitCommands,
  onOpenInGitHub,
  onOpenChatUsage,
  onOpenSettings,
  onToggleSidebar,
  onSignIn,
  onSignOut,
  onDeleteChat,
  onArchiveChat,
  onOpenInVSCode,
  onOpenTerminal,
  onOpenFileBrowser,
  onOpenChanges,
  onToggleTerminal,
  servers,
  onOpenServer,
  onClosePreview,
  onShowPreview,
  onDownloadProject,
  isDownloading,
  onCopyCloneCommand,
  onCopyCheckoutCommand,
  onOpenEnvVars,
  onOpenSkills,
  isAdmin,
  onOpenSandboxResize,
  chatIds,
  currentChatId,
  onSelectChat,
  onNavigateChat,
}: PaletteProviderProps) {
  const { theme, setTheme } = useTheme()
  const [searchOpen, setSearchOpenState] = useState(false)
  const [commandOpen, setCommandOpenState] = useState(false)
  const [jobsSearchOpen, setJobsSearchOpenState] = useState(false)

  // Exclusive: opening one closes the others. Closing any returns focus to
  // the chat prompt so the user can start typing right away.
  const focusPrompt = useCallback(() => {
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>("[data-chat-prompt]")
      el?.focus()
    }, 0)
  }, [])
  const setSearchOpen = useCallback((open: boolean) => {
    setSearchOpenState(open)
    if (open) {
      setCommandOpenState(false)
      setJobsSearchOpenState(false)
    } else focusPrompt()
  }, [focusPrompt])
  const setCommandOpen = useCallback((open: boolean) => {
    setCommandOpenState(open)
    if (open) {
      setSearchOpenState(false)
      setJobsSearchOpenState(false)
    } else focusPrompt()
  }, [focusPrompt])
  const setJobsSearchOpen = useCallback((open: boolean) => {
    setJobsSearchOpenState(open)
    if (open) {
      setSearchOpenState(false)
      setCommandOpenState(false)
    } else focusPrompt()
  }, [focusPrompt])

  const openSearch = useCallback(() => setSearchOpen(true), [setSearchOpen])
  const openCommand = useCallback(() => setCommandOpen(true), [setCommandOpen])
  const openJobsSearch = useCallback(() => setJobsSearchOpen(true), [setJobsSearchOpen])

  // Find current chat index for Alt+Up/Down navigation
  const currentChatIndex = chatIds.findIndex((id) => id === currentChatId)

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + P for search (works even in inputs)
      if (isModKeyPressed(e) && e.key === "p") {
        e.preventDefault()
        openSearch()
        return
      }

      // Cmd/Ctrl + K for commands (works even in inputs)
      if (isModKeyPressed(e) && e.key === "k") {
        e.preventDefault()
        openCommand()
        return
      }

      // Cmd/Ctrl + B for toggle sidebar
      if (isModKeyPressed(e) && e.key === "b") {
        e.preventDefault()
        onToggleSidebar?.()
        return
      }

      // Cmd/Ctrl + J for toggle terminal
      if (isModKeyPressed(e) && e.key === "j") {
        e.preventDefault()
        onToggleTerminal?.()
        return
      }

      // Cmd/Ctrl + S for skills screen
      if (isModKeyPressed(e) && e.key === "s") {
        e.preventDefault()
        onOpenSkills?.()
        return
      }

      // Cmd/Ctrl + Shift + O for branch chat
      if (isModKeyPressed(e) && e.shiftKey && e.key === "O") {
        e.preventDefault()
        onBranchChat?.()
        return
      }

      // Cmd/Ctrl + O for new chat (check after Shift+O to avoid conflict)
      if (isModKeyPressed(e) && !e.shiftKey && e.key === "o") {
        e.preventDefault()
        onNewChat()
        return
      }

      // Alt/Option, Cmd/Meta, or Ctrl (non-macOS) + Up/Down for chat navigation (works even in inputs)
      if ((e.altKey || isModKeyPressed(e)) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
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
  }, [chatIds, currentChatIndex, onSelectChat, openSearch, openCommand, onNavigateChat, onToggleSidebar, onToggleTerminal, onOpenSkills, onNewChat, onBranchChat])

  return (
    <PaletteContext.Provider value={{ openSearch, openCommand, openJobsSearch }}>
      {children}
      <TriggersModal
        open={jobsSearchOpen}
        onOpenChange={setJobsSearchOpen}
      />
      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        repos={repos}
        currentRepo={currentRepo}
        branches={branches}
        chats={chats}
        sidebarRepos={sidebarRepos}
        onSelectRepo={onSelectRepo}
        onSelectBranch={onSelectBranch}
        onSelectChat={onSelectChat}
        onFilterRepo={onFilterRepo}
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
        onOpenChatUsage={onOpenChatUsage}
        onOpenSettings={onOpenSettings}
        onToggleSidebar={onToggleSidebar}
        onSignIn={onSignIn}
        onSignOut={onSignOut}
        onDeleteChat={onDeleteChat}
        onArchiveChat={onArchiveChat}
        onOpenInVSCode={onOpenInVSCode}
        onOpenTerminal={onOpenTerminal}
        onOpenFileBrowser={onOpenFileBrowser}
        onOpenChanges={onOpenChanges}
        servers={servers}
        onOpenServer={onOpenServer}
        onClosePreview={onClosePreview}
        onShowPreview={onShowPreview}
        onDownloadProject={onDownloadProject}
        isDownloading={isDownloading}
        onCopyCloneCommand={onCopyCloneCommand}
        onCopyCheckoutCommand={onCopyCheckoutCommand}
        onOpenEnvVars={onOpenEnvVars}
        onOpenSkills={onOpenSkills}
        isAdmin={isAdmin}
        onOpenSandboxResize={onOpenSandboxResize}
        chats={chats.map((c) => ({ id: c.id, displayName: c.displayName }))}
        onSelectChat={onSelectChat}
        currentTheme={(theme as Theme) ?? "system"}
        onThemeChange={(newTheme: Theme) => setTheme(newTheme)}
      />
    </PaletteContext.Provider>
  )
}
