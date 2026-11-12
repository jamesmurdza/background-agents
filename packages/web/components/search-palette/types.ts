/**
 * Shared types for search palette components
 */

import type { SectionKey } from "@/components/modals/SettingsModal"

/**
 * Minimal chat interface for search palette components
 * Contains only the fields needed for search and display
 */
export interface PaletteChat {
  id: string
  displayName: string | null
  repo: string
}

/**
 * Command actions shared by the command palette and the provider that hosts it.
 * PaletteProvider accepts these and forwards them verbatim to CommandPalette, so
 * both declare the set via this interface to stop the two lists drifting apart.
 */
export interface PaletteCommandCallbacks {
  onRunCommand: (command: string) => void
  onNewChat: () => void
  /** Omitted when the current chat has no branch to fork from. */
  onBranchChat?: () => void
  /** Present only when the current chat has no linked repo — opens the repo picker. */
  onCreateRepo?: () => void
  /** When false, the Git Commands group (merge/rebase/pr/squash) is hidden. */
  showGitCommands?: boolean
  /** Omitted when the current chat has no pushed branch on GitHub. */
  onOpenInGitHub?: () => void
  /** Show this chat's per-provider token usage. Omitted when no chat is active. */
  onOpenChatUsage?: () => void
  onOpenSettings: (section?: SectionKey) => void
  onToggleSidebar?: () => void
  onSignIn?: () => void
  onSignOut?: () => void
  onDeleteChat?: () => void
  /** Archive the current chat. Omitted when no chat is active or it's already archived. */
  onArchiveChat?: () => void
  onOpenInVSCode?: () => void
  onOpenTerminal?: () => void
  /** Open a simple file browser rooted at the sandbox's home directory. */
  onOpenFileBrowser?: () => void
  /** Open the diff of everything this chat's branch changed. */
  onOpenChanges?: () => void
  servers?: Array<{ port: number; url: string }>
  onOpenServer?: (port: number, url: string) => void
  onClosePreview?: () => void
  /** Show the preview pane (when hidden but has items). */
  onShowPreview?: () => void
  /** Download the project as a zip file. Omitted when no sandbox exists. */
  onDownloadProject?: () => void
  /** Whether a download is currently in progress. */
  isDownloading?: boolean
  /** Copy git clone command to clipboard. Omitted when no repo is linked. */
  onCopyCloneCommand?: () => void
  /** Copy git checkout command to clipboard. Omitted when no branch exists. */
  onCopyCheckoutCommand?: () => void
  /** Open environment variables modal. Omitted when no chat is active. */
  onOpenEnvVars?: () => void
  /** Open skills manager. Omitted when no sandbox exists. */
  onOpenSkills?: () => void
  /** Whether the current user is an admin — gates the "Sandbox resources" command. */
  isAdmin?: boolean
  /** Open the sandbox resources modal. Omitted when not an admin, or no sandbox/draft chat exists. */
  onOpenSandboxResize?: () => void
}
