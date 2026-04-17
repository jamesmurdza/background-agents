"use client"

import { GitMerge, GitBranch, GitPullRequest, GitCommitVertical } from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command"
import { SLASH_COMMANDS } from "@upstream/common"

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  GitMerge,
  GitBranch,
  GitPullRequest,
  GitCommitVertical,
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRunCommand: (command: string) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  onRunCommand,
}: CommandPaletteProps) {
  const handleSelect = (command: string) => {
    onRunCommand(command)
    onOpenChange(false)
  }

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
      </CommandList>
    </CommandDialog>
  )
}
