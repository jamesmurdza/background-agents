"use client"

import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical, Plus, GitBranchPlus, Settings, Github, PanelLeft, LogIn, LogOut, FolderGit2, Trash2, Code2, TerminalSquare, Globe, PanelRightClose, PanelRightOpen, Download, Copy, MessageSquare, Key, Sun, Moon, Monitor } from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { SLASH_COMMANDS } from "@upstream/common"
import type { SectionKey } from "@/components/modals/SettingsModal"
import type { Theme } from "@/lib/types"

/** Custom italic x icon for variables */
function VariableIcon({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center italic font-serif", className)}>
      𝑥
    </span>
  )
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  GitMerge,
  GitBranch,
  GitPullRequest,
  GitCommitVertical,
  GitBranchPlus,
  FolderGit2,
}

interface ChatItem {
  id: string
  displayName: string | null
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  onOpenSettings: (section?: SectionKey) => void
  onToggleSidebar?: () => void
  onSignIn?: () => void
  onSignOut?: () => void
  onDeleteChat?: () => void
  onOpenInVSCode?: () => void
  onOpenTerminal?: () => void
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
  /** Chats for search. */
  chats?: ChatItem[]
  /** Select a chat from search. */
  onSelectChat?: (chatId: string) => void
  /** Current theme value. */
  currentTheme?: Theme
  /** Change theme. */
  onThemeChange?: (theme: Theme) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  onRunCommand,
  onNewChat,
  onBranchChat,
  onCreateRepo,
  showGitCommands = true,
  onOpenInGitHub,
  onOpenSettings,
  onToggleSidebar,
  onSignIn,
  onSignOut,
  onDeleteChat,
  onOpenInVSCode,
  onOpenTerminal,
  servers = [],
  onOpenServer,
  onClosePreview,
  onShowPreview,
  onDownloadProject,
  isDownloading = false,
  onCopyCloneCommand,
  onCopyCheckoutCommand,
  onOpenEnvVars,
  chats = [],
  onSelectChat,
  currentTheme = "system",
  onThemeChange,
}: CommandPaletteProps) {
  const handleSelect = (command: string) => {
    onRunCommand(command)
    onOpenChange(false)
  }

  const run = (fn: () => void) => {
    fn()
    onOpenChange(false)
  }

  const themeIconMap: Record<Theme, typeof Sun> = {
    system: Monitor,
    light: Sun,
    dark: Moon,
  }

  const themeLabels: Record<Theme, string> = {
    system: "Auto",
    light: "Light",
    dark: "Dark",
  }

  const settingItems: { value: string; label: string; section: SectionKey; icon: typeof Settings }[] = [
    { value: "settings general", label: "General settings", section: "general", icon: Settings },
    { value: "settings api keys credentials", label: "API keys", section: "api-keys", icon: Key },
    { value: "settings appearance theme", label: "Appearance", section: "appearance", icon: Sun },
    { value: "settings default agent", label: "Default agent", section: "general", icon: Settings },
    { value: "settings default model", label: "Default model", section: "general", icon: Settings },
  ]

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Commands"
      description="Run a command"
    >
      <CommandInput placeholder="Type a command..." />
      <CommandList>
        <CommandEmpty>No commands found.</CommandEmpty>
        {chats.length > 0 && onSelectChat && (
          <CommandGroup heading="Chats">
            {chats.map((chat) => (
              <CommandItem
                key={chat.id}
                value={`chat:${chat.displayName ?? "untitled"}:${chat.id}`}
                onSelect={() => run(() => onSelectChat(chat.id))}
              >
                <MessageSquare className="mr-2 h-4 w-4 text-muted-foreground" />
                <span>{chat.displayName ?? "Untitled Chat"}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Chat">
          <CommandItem value="new chat" onSelect={() => run(onNewChat)}>
            <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>New chat</span>
          </CommandItem>
          {onBranchChat && (
            <CommandItem value="branch chat" onSelect={() => run(onBranchChat)}>
              <GitBranchPlus className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Branch from current chat</span>
            </CommandItem>
          )}
          {onCreateRepo && (
            <CommandItem value="create repository" onSelect={() => run(onCreateRepo)}>
              <FolderGit2 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Create repository</span>
            </CommandItem>
          )}
          {onOpenInGitHub && (
            <CommandItem value="open in github" onSelect={() => run(onOpenInGitHub)}>
              <Github className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Open in GitHub</span>
            </CommandItem>
          )}
          {onCopyCloneCommand && (
            <CommandItem value="copy git clone repository command" onSelect={() => run(onCopyCloneCommand)}>
              <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Copy Git clone repository command</span>
            </CommandItem>
          )}
          {onCopyCheckoutCommand && (
            <CommandItem value="copy git checkout branch command" onSelect={() => run(onCopyCheckoutCommand)}>
              <Copy className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Copy Git checkout branch command</span>
            </CommandItem>
          )}
          {onOpenInVSCode && (
            <CommandItem value="open in vs code" onSelect={() => run(onOpenInVSCode)}>
              <Code2 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Open in VS Code</span>
            </CommandItem>
          )}
          {onOpenTerminal && (
            <CommandItem value="open terminal" onSelect={() => run(onOpenTerminal)}>
              <TerminalSquare className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Open terminal</span>
            </CommandItem>
          )}
          {onOpenServer && servers.length > 0 && (
            <CommandItem
              value="open live preview"
              onSelect={() => run(() => onOpenServer(servers[0].port, servers[0].url))}
            >
              <Globe className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Open live preview</span>
            </CommandItem>
          )}
          {onClosePreview && (
            <CommandItem value="hide close preview pane" onSelect={() => run(onClosePreview)}>
              <PanelRightClose className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Hide preview pane</span>
            </CommandItem>
          )}
          {onShowPreview && (
            <CommandItem value="show open preview pane" onSelect={() => run(onShowPreview)}>
              <PanelRightOpen className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Show preview pane</span>
            </CommandItem>
          )}
          {onDownloadProject && (
            <CommandItem
              value="download project"
              onSelect={() => run(onDownloadProject)}
              disabled={isDownloading}
            >
              <Download className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{isDownloading ? "Downloading..." : "Download project"}</span>
            </CommandItem>
          )}
          {onOpenEnvVars && (
            <CommandItem value="environment variables" onSelect={() => run(onOpenEnvVars)}>
              <VariableIcon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Environment variables</span>
            </CommandItem>
          )}
          {onDeleteChat && (
            <CommandItem value="delete chat" onSelect={() => run(onDeleteChat)}>
              <Trash2 className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Delete chat</span>
            </CommandItem>
          )}
        </CommandGroup>
        {showGitCommands && (
          <CommandGroup heading="Git Commands">
            {SLASH_COMMANDS.map((cmd) => {
              const Icon = iconMap[cmd.icon]
              return (
                <CommandItem
                  key={cmd.name}
                  value={cmd.name}
                  onSelect={() => handleSelect(cmd.name)}
                >
                  {Icon && <Icon className="mr-2 h-4 w-4 text-muted-foreground" />}
                  <span>{cmd.description}</span>
                  <CommandShortcut>/{cmd.name}</CommandShortcut>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        <CommandGroup heading="Settings">
          {settingItems.map((item) => (
            <CommandItem
              key={item.value}
              value={item.value}
              onSelect={() => run(() => onOpenSettings(item.section))}
            >
              <item.icon className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {onThemeChange && (
          <CommandGroup heading="Theme">
            {(["system", "light", "dark"] as Theme[]).map((theme) => {
              const Icon = themeIconMap[theme]
              return (
                <CommandItem
                  key={theme}
                  value={`theme ${theme} ${themeLabels[theme]}`}
                  onSelect={() => run(() => onThemeChange(theme))}
                >
                  <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span>{themeLabels[theme]}</span>
                  {currentTheme === theme && (
                    <CommandShortcut>Active</CommandShortcut>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        <CommandGroup heading="Application">
          {onToggleSidebar && (
            <CommandItem value="toggle sidebar" onSelect={() => run(onToggleSidebar)}>
              <PanelLeft className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Toggle sidebar</span>
            </CommandItem>
          )}
          <CommandItem value="settings" onSelect={() => run(() => onOpenSettings())}>
            <Settings className="mr-2 h-4 w-4 text-muted-foreground" />
            <span>Settings</span>
          </CommandItem>
          {onSignIn && (
            <CommandItem value="sign in" onSelect={() => run(onSignIn)}>
              <LogIn className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Sign in</span>
            </CommandItem>
          )}
          {onSignOut && (
            <CommandItem value="sign out" onSelect={() => run(onSignOut)}>
              <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
              <span>Sign out</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
