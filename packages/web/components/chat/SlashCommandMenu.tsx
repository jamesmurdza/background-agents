"use client"

import { useEffect, useRef, useCallback } from "react"
import { GitMerge, GitBranch, GitPullRequest } from "lucide-react"
import { cn } from "@/lib/shared/utils"
import { filterSlashCommands, type SlashCommand } from "@upstream/common"

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  GitMerge,
  GitBranch,
  GitPullRequest,
}

export type SlashCommandType = "merge" | "rebase" | "pr"

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
}

export function SlashCommandMenu({
  input,
  open,
  onSelect,
  onClose,
  selectedIndex,
  onSelectedIndexChange,
}: SlashCommandMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const filteredCommands = filterSlashCommands(input)

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
        "absolute bottom-full left-0 mb-1 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg",
        "z-50"
      )}
    >
      <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Git Commands
      </div>
      {filteredCommands.map((cmd, index) => {
        const Icon = ICON_MAP[cmd.icon]
        return (
          <button
            key={cmd.name}
            onClick={() => handleSelect(cmd)}
            onMouseEnter={() => onSelectedIndexChange(index)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors cursor-pointer",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/50"
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="flex flex-col items-start">
              <span className="font-medium">/{cmd.name}</span>
              <span className="text-xs text-muted-foreground">{cmd.description}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Hook to manage slash command menu state
 */
export function useSlashCommandMenu(
  input: string,
  onClearInput: () => void,
  handlers: {
    onMerge: () => void
    onRebase: () => void
    onPR: () => void
  }
) {
  const [open, setOpen] = React.useState(false)
  const [selectedIndex, setSelectedIndex] = React.useState(0)

  // Open menu when "/" is the first character
  useEffect(() => {
    if (input.startsWith("/")) {
      setOpen(true)
    } else {
      setOpen(false)
      setSelectedIndex(0)
    }
  }, [input])

  const filteredCommands = filterSlashCommands(input)

  const handleSelect = useCallback(
    (command: SlashCommandType) => {
      setOpen(false)
      onClearInput()
      setSelectedIndex(0)

      switch (command) {
        case "merge":
          handlers.onMerge()
          break
        case "rebase":
          handlers.onRebase()
          break
        case "pr":
          handlers.onPR()
          break
      }
    },
    [handlers, onClearInput]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return false

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
            handleSelect(filteredCommands[selectedIndex].name as SlashCommandType)
          }
          return true
        case "Escape":
          e.preventDefault()
          setOpen(false)
          setSelectedIndex(0)
          return true
        case "Tab":
          e.preventDefault()
          if (filteredCommands[selectedIndex]) {
            handleSelect(filteredCommands[selectedIndex].name as SlashCommandType)
          }
          return true
        default:
          return false
      }
    },
    [open, filteredCommands, selectedIndex, handleSelect]
  )

  const close = useCallback(() => {
    setOpen(false)
    setSelectedIndex(0)
  }, [])

  return {
    open,
    selectedIndex,
    setSelectedIndex,
    handleSelect,
    handleKeyDown,
    close,
  }
}

// Need React import for useState
import * as React from "react"
