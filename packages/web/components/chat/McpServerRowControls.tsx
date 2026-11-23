"use client"

/**
 * Shared, closure-free row controls for McpServersCombobox — the gear button
 * (and its dropdown) that opens settings for a first-party server row, plus
 * the "unlink account" menu item used inside it.
 */

import { Settings, Trash2 } from "lucide-react"
import { type ReactNode, type SyntheticEvent } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const ROW_SETTINGS_BUTTON =
  "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"

/**
 * Keeps events inside a row control from reaching the enclosing CommandItem.
 * React bubbles events through portals along the component tree, so without
 * this a click (or Enter) inside a portaled menu also fires cmdk's row
 * select, which toggles the server off.
 */
export function RowControl({ children }: { children: ReactNode }) {
  const stop = (e: SyntheticEvent) => e.stopPropagation()
  return (
    <div
      className="contents"
      onClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onKeyDown={stop}
    >
      {children}
    </div>
  )
}

/** Gear button that opens a settings dialog for a first-party row. */
export function RowSettingsButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <RowControl>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={ROW_SETTINGS_BUTTON}
        aria-label={label}
        title={label}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </RowControl>
  )
}

/** Gear button + dropdown on a first-party row. */
export function RowSettingsMenu({
  label,
  disabled,
  children,
}: {
  label: string
  disabled: boolean
  children: ReactNode
}) {
  return (
    <RowControl>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={ROW_SETTINGS_BUTTON}
            aria-label={label}
            title={label}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </RowControl>
  )
}

export function UnlinkMenuItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  )
}
