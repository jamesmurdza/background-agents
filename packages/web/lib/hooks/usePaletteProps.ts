"use client"

import type React from "react"
import { useSession, signOut } from "next-auth/react"
import { signInWithGitHub } from "@/lib/auth-utils"
import { clearAllStorage } from "@/lib/storage"
import { PaletteProvider } from "@/components/search-palette"
import type { GitHubRepo, GitHubBranch } from "@/lib/github"
import { NEW_REPOSITORY, isRealRepo, type Chat } from "@/lib/types"
import type { useModals, useSidebar } from "@/lib/contexts"
import type { usePreview } from "@/lib/hooks/usePreview"
import { useGitHubUserQuery } from "@/lib/query"
import { getChatRepos } from "@/components/sidebar/index"
import { isDraftChatId } from "@/lib/chat-state"
import { PATHS } from "@background-agents/common"
import { materializeAndEnsureSandbox } from "@/lib/sandbox-client"
import { useToastStore } from "@/lib/stores/toast-store"

/** All props the PaletteProvider takes, minus `children` (supplied by JSX). */
export type PaletteProps = Omit<React.ComponentProps<typeof PaletteProvider>, "children">

interface UsePalettePropsOptions {
  // Data
  isMobile: boolean
  repos: GitHubRepo[]
  branches: GitHubBranch[]
  displayChats: Chat[]
  displayCurrentChatId: string | null
  currentChat: Chat | null
  /** Repo picked for a new chat that hasn't sent its first message yet. */
  draftRepo: string | null
  availableServers: Array<{ port: number; url: string }>
  canBranch: boolean

  // Sandbox actions
  githubBranchUrl: string | null
  isDownloading: boolean
  handleOpenInGitHub: () => void
  handleOpenInVSCode: () => void
  handleDownloadProject: () => void
  handleCopyCloneCommand: () => void
  handleCopyCheckoutCommand: () => void
  handleOpenEnvVars: () => void
  /** Archive the given chat (moves it out of the active list). */
  handleArchiveChat: (chatId: string) => void

  // Navigation / chat handlers
  handlePaletteSelectRepo: (repo: GitHubRepo) => void
  handlePaletteSelectBranch: (repo: GitHubRepo, branch: GitHubBranch) => void
  /** Set the sidebar's repository filter (used by Command P repo selection). */
  handleRepoFilterChange: (filter: string) => void
  handleRunCommand: (command: string) => void
  handleNewChat: () => void
  handleBranchChat: () => void
  handleCreateRepo: () => void
  handleNavigateChat: (direction: "up" | "down") => void
  handleSelectChat: (chatId: string) => void

  // Context hooks (passed as the resolved values)
  modals: ReturnType<typeof useModals>
  sidebar: ReturnType<typeof useSidebar>
  preview: ReturnType<typeof usePreview>

  // Toggles
  onToggleSkillsModal: () => void

  /** Materializes a draft chat into a real one; see lib/hooks/useChatWithSync.ts. */
  materializeDraft: (draftId: string) => Promise<Chat | null>
  /** Draft chat's staged config (repo, pending env vars, etc.), if there is one. */
  draftChatConfig?: { id: string; pendingEnvironmentVariables?: Record<string, string> }
  /** Stage/update the draft chat's config. */
  updateDraftChatConfig?: (updates: { pendingEnvironmentVariables?: Record<string, string> }) => void
}

/**
 * Assembles the (large) props object passed to `<PaletteProvider>`.
 *
 * The palette aggregates *every* keyboard-accessible action in the app — chat
 * navigation, git operations, terminal/preview management, sign-in/out, theme,
 * etc. — so the props list is intrinsically long. Keeping it inline in page.tsx
 * created ~75 lines of dense, nested-ternary JSX. This hook owns that
 * assembly so the JSX collapses to `<PaletteProvider {...paletteProps}>`.
 */
export function usePaletteProps({
  isMobile,
  repos,
  branches,
  displayChats,
  displayCurrentChatId,
  currentChat,
  draftRepo,
  availableServers,
  canBranch,
  githubBranchUrl,
  isDownloading,
  handleOpenInGitHub,
  handleOpenInVSCode,
  handleDownloadProject,
  handleCopyCloneCommand,
  handleCopyCheckoutCommand,
  handleOpenEnvVars,
  handleArchiveChat,
  handlePaletteSelectRepo,
  handlePaletteSelectBranch,
  handleRepoFilterChange,
  handleRunCommand,
  handleNewChat,
  handleBranchChat,
  handleCreateRepo,
  handleNavigateChat,
  handleSelectChat,
  modals,
  sidebar,
  preview,
  onToggleSkillsModal,
  materializeDraft,
  draftChatConfig,
  updateDraftChatConfig,
}: UsePalettePropsOptions): PaletteProps {
  const { data: session } = useSession()
  const { data: currentUserLogin } = useGitHubUserQuery()

  // Repositories shown in the sidebar's repository selector — reused so Command
  // P lists exactly the same repos.
  const sidebarRepos = getChatRepos(displayChats, currentUserLogin)

  const sandboxId = currentChat?.sandboxId ?? null
  const hasRepo = isRealRepo(currentChat?.repo)

  // Commands that address a chat row on the server (usage, delete, archive) are
  // only offered once the chat has been written to the database. A draft chat
  // lives in the browser only, so those requests would 404.
  const savedChatId = isDraftChatId(displayCurrentChatId) ? null : displayCurrentChatId

  // Draft chats have no sandbox yet. Materialize the draft into a real chat
  // row and make sure it has a running sandbox before proceeding — same
  // helper the Merge dialog uses (see lib/sandbox-client.ts).
  const ensureSandboxForDraft = async (): Promise<string | null> => {
    if (!displayCurrentChatId || !isDraftChatId(displayCurrentChatId)) return null
    useToastStore.getState().addToast({ title: "Starting sandbox…", body: "This only takes a moment." })
    const ensured = await materializeAndEnsureSandbox(displayCurrentChatId, materializeDraft, {
      environmentVariables: draftChatConfig?.pendingEnvironmentVariables,
      clearPending: () => updateDraftChatConfig?.({ pendingEnvironmentVariables: undefined }),
    })
    if (!ensured) {
      useToastStore.getState().addToast({ title: "Couldn't start sandbox", body: "Try again." })
      return null
    }
    return ensured.sandboxId
  }

  // Find or create a uniquely-numbered terminal id for this sandbox. We scan
  // existing terminal preview items, pull the trailing `-<n>` suffix from each,
  // and pick the next integer above the highest one we've seen.
  const openNewTerminal = async () => {
    const resolvedSandboxId = sandboxId ?? (await ensureSandboxForDraft())
    if (!resolvedSandboxId) return
    const existingTerminals = preview.previewItems.filter((i) => i.type === "terminal")
    const terminalNumbers = existingTerminals.map((t) => {
      if (t.type !== "terminal") return 0
      const match = t.id.match(/-(\d+)$/)
      return match ? parseInt(match[1], 10) : 1
    })
    const nextNumber = terminalNumbers.length === 0 ? 1 : Math.max(...terminalNumbers) + 1
    preview.openPreview({ type: "terminal", id: `${resolvedSandboxId}-${nextNumber}` })
  }

  // Toggle the terminal preview pane: if a terminal already exists, just
  // show/hide the pane; otherwise create one.
  const toggleTerminal = async () => {
    const existingTerminal = preview.previewItems.find((i) => i.type === "terminal")
    if (existingTerminal) {
      if (preview.previewOpen) {
        preview.closePreview()
      } else {
        preview.openPreview(existingTerminal)
      }
      return
    }
    const resolvedSandboxId = sandboxId ?? (await ensureSandboxForDraft())
    if (!resolvedSandboxId) return
    preview.openPreview({ type: "terminal", id: `${resolvedSandboxId}-1` })
  }

  return {
    repos,
    currentRepo: hasRepo ? currentChat!.repo : null,
    branches,
    // Ordered by recency (pinned first), matching the sidebar chat list so the
    // command palettes present chats in the same order the user sees them.
    chats: displayChats
      .filter((c) => c.displayName !== null)
      .slice()
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
        return (b.lastActiveAt ?? b.createdAt) - (a.lastActiveAt ?? a.createdAt)
      })
      .map((c) => ({ id: c.id, displayName: c.displayName, repo: c.repo })),
    sidebarRepos,
    onSelectRepo: handlePaletteSelectRepo,
    onSelectBranch: handlePaletteSelectBranch,
    onFilterRepo: handleRepoFilterChange,
    onRunCommand: handleRunCommand,
    onNewChat: handleNewChat,
    onBranchChat: canBranch ? handleBranchChat : undefined,
    onCreateRepo: currentChat?.repo === NEW_REPOSITORY ? handleCreateRepo : undefined,
    showGitCommands: hasRepo,
    onOpenInGitHub: githubBranchUrl ? handleOpenInGitHub : undefined,
    onOpenChatUsage: savedChatId
      ? () => modals.openChatUsage(savedChatId)
      : undefined,
    onOpenSettings: modals.openSettingsSection,
    onToggleSidebar: !isMobile ? () => sidebar.toggleCollapse() : undefined,
    onSignIn: !session ? () => signInWithGitHub() : undefined,
    onSignOut: session
      ? () => {
          clearAllStorage()
          signOut()
        }
      : undefined,
    onDeleteChat: savedChatId
      ? () => modals.setDeleteConfirmChatId(savedChatId)
      : undefined,
    onArchiveChat:
      savedChatId && !currentChat?.archived
        ? () => handleArchiveChat(savedChatId)
        : undefined,
    // "Open in VS Code" and Terminal can also run on a draft chat: they
    // materialize it + boot a sandbox first (see ensureSandboxForDraft above).
    onOpenInVSCode: sandboxId || isDraftChatId(displayCurrentChatId) ? handleOpenInVSCode : undefined,
    onOpenTerminal: sandboxId || isDraftChatId(displayCurrentChatId) ? openNewTerminal : undefined,
    onOpenFileBrowser: sandboxId
      ? () => preview.openPreview({ type: "directory", dirPath: PATHS.SANDBOX_HOME })
      : undefined,
    onOpenChanges: sandboxId && hasRepo ? () => preview.openPreview({ type: "changes" }) : undefined,
    onToggleTerminal: sandboxId || isDraftChatId(displayCurrentChatId) ? toggleTerminal : undefined,
    servers: availableServers,
    onOpenServer: (port, url) => preview.openPreview({ type: "server", port, url }),
    onClosePreview: preview.previewOpen ? preview.closePreview : undefined,
    onShowPreview:
      preview.previewPaneHidden && preview.previewItems.length > 0
        ? preview.showPreview
        : undefined,
    onDownloadProject: sandboxId ? handleDownloadProject : undefined,
    isDownloading,
    onCopyCloneCommand: hasRepo ? handleCopyCloneCommand : undefined,
    onCopyCheckoutCommand: currentChat?.branch ? handleCopyCheckoutCommand : undefined,
    onOpenEnvVars: currentChat ? handleOpenEnvVars : undefined,
    onOpenSkills: hasRepo || isRealRepo(draftRepo) ? onToggleSkillsModal : undefined,
    isAdmin: !!session?.user?.isAdmin,
    onOpenSandboxResize:
      sandboxId && session?.user?.isAdmin ? () => modals.setSandboxResizeModalOpen(true) : undefined,
    chatIds: displayChats.map((c) => c.id),
    onNavigateChat: handleNavigateChat,
    currentChatId: displayCurrentChatId,
    onSelectChat: handleSelectChat,
  }
}
