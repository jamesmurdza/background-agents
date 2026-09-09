"use client"

import { useState } from "react"
import { Boxes, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { isRealRepo } from "@/lib/types"
// Type-only: EnvironmentDTO's module imports @/lib/db/prisma. A plain value
// import here would pull Prisma into the browser bundle.
import type { EnvironmentDTO } from "@/lib/environments"
import { useEnvironmentsQuery } from "@/lib/query/hooks/useEnvironmentsQuery"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

interface EnvironmentComboboxProps {
  /** Repo full_name the chat is on, NEW_REPOSITORY, or null (no repo yet). */
  repo: string | null
  /** The chat's currently pinned environment id, or null. */
  value: string | null
  /** Called with the id of the environment the user picked. */
  onChange: (environmentId: string) => void
  /** True once the chat has a sandbox (or has messages): the environment is
   *  fixed from then on, the same rule the repo picker follows. */
  disabled?: boolean
  isMobile?: boolean
  showLabel?: boolean
}

/**
 * Whether the picker should render at all, and which environment it should
 * show as selected, given the repo's environments and the chat's current
 * value.
 *
 * A repo with fewer than two environments has nothing to choose between: the
 * sole environment is already applied server-side, so showing a one-item
 * dropdown before any value is pinned would just be noise. Once a value IS
 * pinned (the chat exists and has been resolved to a concrete environment),
 * the control stays visible even with one option: at that point it is no
 * longer a choice, it's a statement of which environment this chat actually
 * uses, and hiding it would let a user believe a chat has none.
 */
export function resolveEnvironmentPicker(
  environments: EnvironmentDTO[],
  value: string | null
): { visible: boolean; selected: EnvironmentDTO | undefined } {
  if (environments.length < 2 && !value) {
    return { visible: false, selected: undefined }
  }
  const selected =
    environments.find((e) => e.id === value) ?? environments.find((e) => e.isDefault)
  return { visible: true, selected }
}

export function EnvironmentCombobox({
  repo,
  value,
  onChange,
  disabled = false,
  isMobile = false,
  showLabel = false,
}: EnvironmentComboboxProps) {
  const [open, setOpen] = useState(false)
  const queryRepo = repo && isRealRepo(repo) ? repo : undefined
  const { data: environments = [] } = useEnvironmentsQuery(queryRepo)

  // NEW_REPOSITORY chats (and chats with no repo yet) have no repo to scope
  // an environment to.
  if (!isRealRepo(repo)) return null

  const { visible, selected } = resolveEnvironmentPicker(environments, value)
  if (!visible) return null

  const displayLabel = selected?.name ?? "Environment"

  const handleSelect = (environmentId: string) => {
    onChange(environmentId)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Environment"
          className={cn(
            "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          title={
            disabled
              ? `${displayLabel} (fixed once a chat has started)`
              : displayLabel
          }
        >
          <Boxes className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          <span className={cn(
            showLabel ? "inline" : (isMobile ? "hidden @[16rem]/row1:inline" : "hidden @[32rem]:inline")
          )}>
            {displayLabel}
          </span>
          <ChevronDown className={cn(isMobile ? "h-4 w-4 hidden @[16rem]/row1:block" : "h-3.5 w-3.5")} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-0"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <Command>
          <CommandList>
            <CommandEmpty>No environments</CommandEmpty>
            <CommandGroup>
              {environments.map((env) => (
                <CommandItem
                  key={env.id}
                  value={env.id}
                  onSelect={() => handleSelect(env.id)}
                  className={cn(
                    "flex items-center gap-2 cursor-pointer",
                    selected?.id === env.id && "bg-accent"
                  )}
                >
                  <Boxes className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate">{env.name}</span>
                  {env.isDefault && (
                    <span className="text-xs text-muted-foreground">default</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
