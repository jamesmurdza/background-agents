"use client"

import { useEffect, useRef, useCallback, useMemo, useState } from "react"
import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical, FolderGit2, GitBranchPlus, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { filterSlashCommands, filterSlashCommandsWithConflict, type SlashCommand } from "@upstream/common"

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  GitMerge,
  GitBranch,
  GitPullRequest,
  GitCommitVertical,
  FolderGit2,
  GitBranchPlus,
  XCircle,
}

export type SlashCommandType = "merge" | "rebase" | "pr" | "squash" | "repo" | "branch" | "abort"

interface SlashCommandMenuProps {
  /** The current input value (used for filtering) */
  input: string
  /** Whether the menu is open */
  open: boolean
  /** Callback when a command is selected */
  onSelect: (command: SlashCommandType) => void
  /** Callback to close the menu */
  onClose: () => void
  /** Currently highlighted index for keyboard navigation */
  selectedIndex: number
  /** Callback to update the selected index */
  onSelectedIndexChange: (index: number) => void
  /** Whether the chat has a linked repo (git commands only show when true) */
  hasLinkedRepo?: boolean
  /** Whether we're in a merge/rebase conflict */
  inConflict?: boolean
  /** Mobile mode */
  isMobile?: boolean
}

const CREATE_REPO_COMMAND: SlashCommand = {
  name: "repo",
  label: "Repository",
  description: "Create repository",
  icon: "FolderGit2",
}

function filterSingleCommand(input: string, cmd: SlashCommand): SlashCommand[] {
  const filter = input.startsWith("/") ? input.slice(1).toLowerCase() : input.toLowerCase()
  if (!filter) return [cmd]
  // Match typed-in prefix against the command name.
  return cmd.name.toLowerCase().startsWith(filter) ? [cmd] : []
}

export function SlashCommandMenu({
  input,
  open,
  onSelect,
  onClose,
  selectedIndex,
  onSelectedIndexChange,
  hasLinkedRepo = true,
  inConflict = false,
  isMobile = false,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const filteredCommands = hasLinkedRepo
    ? filterSlashCommandsWithConflict(input, inConflict)
    : filterSingleCommand(input, CREATE_REPO_COMMAND)

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open, onClose])

  // Reset selected index when filtered commands change
  useEffect(() => {
    if (selectedIndex >= filteredCommands.length) {
      onSelectedIndexChange(Math.max(0, filteredCommands.length - 1))
    }
  }, [filteredCommands.length, selectedIndex, onSelectedIndexChange])

  const handleSelect = useCallback(
    (command: SlashCommand) => {
      onSelect(command.name as SlashCommandType)
    },
    [onSelect]
  )

  if (!open || filteredCommands.length === 0) {
    return null
  }

  return (
    <div
      ref={menuRef}
      className={cn(
        "absolute bottom-full left-0 mb-1 rounded-lg border border-border bg-popover p-1 shadow-lg z-50",
        isMobile ? "right-0" : "w-64"
      )}
    >
      <div className={cn(
        "px-2 py-1.5 font-medium text-muted-foreground uppercase tracking-wider",
        isMobile ? "text-xs" : "text-[10px]"
      )}>
        {hasLinkedRepo ? "Git Commands" : "Repository"}
      </div>
      {filteredCommands.map((cmd, index) => {
        const Icon = ICON_MAP[cmd.icon]
        return (
          <button
            key={cmd.name}
            onClick={() => handleSelect(cmd)}
            onMouseEnter={() => onSelectedIndexChange(index)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 transition-colors cursor-pointer",
              isMobile ? "py-3 text-base" : "py-2 text-sm",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/50"
            )}
          >
            {Icon && <Icon className={cn(
              "shrink-0 text-muted-foreground",
              isMobile ? "h-5 w-5" : "h-4 w-4"
            )} />}
            <div className="flex flex-col items-start">
              <span className="font-medium">/{cmd.name}</span>
              <span className={cn(
                "text-muted-foreground",
                isMobile ? "text-sm" : "text-xs"
              )}>{cmd.description}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Hook to manage slash command menu state and keyboard navigation
 */
export function useSlashCommandMenu(input: string, inConflict: boolean = false) {
  const [open, setOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Open menu when "/" is the first character
  useEffect(() => {
    if (input.startsWith("/")) {
      setOpen(true)
    } else {
      setOpen(false)
      setSelectedIndex(0)
    }
  }, [input])

  const filteredCommands = useMemo(
    () => filterSlashCommandsWithConflict(input, inConflict),
    [input, inConflict]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, onSelect: (command: SlashCommandType) => void, onClear: () => void) => {
      if (!open || filteredCommands.length === 0) return false

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : 0
          )
          return true
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredCommands.length - 1
          )
          return true
        case "Enter":
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex].name as SlashCommandType)
            onClear()
            setOpen(false)
            setSelectedIndex(0)
          }
          return true
        case "Tab":
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            onSelect(filteredCommands[selectedIndex].name as SlashCommandType)
            onClear()
            setOpen(false)
            setSelectedIndex(0)
          }
          return true
        case "Escape":
          e.preventDefault()
          setOpen(false)
          setSelectedIndex(0)
          onClear()
          return true
        default:
          return false
      }
    },
    [open, filteredCommands, selectedIndex]
  )

  const close = useCallback(() => {
    setOpen(false)
    setSelectedIndex(0)
  }, [])

  return {
    open,
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    close,
    filteredCommands,
  }
}
