"use client"

import { useState } from "react"
import { Eye, EyeOff, Copy, Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCopyToClipboard } from "@/lib/hooks/useCopyToClipboard"
import { Input } from "@/components/ui/input"
import { CREDENTIAL_KEYS, type CredentialId } from "@/lib/credentials"
import type { CredentialFlags } from "@/lib/types"

/** Placeholder shown in API-key fields for credentials the server already has. */
export const MASK = "***"

/**
 * Initial input values: "***" for credentials the server has but won't echo
 * back, or "" when unset.
 */
export function initialCredValues(
  flags: CredentialFlags
): Record<CredentialId, string> {
  const out = {} as Record<CredentialId, string>
  for (const { id } of CREDENTIAL_KEYS) {
    out[id] = flags[id] ? MASK : ""
  }
  return out
}

/**
 * A single settings row: label + optional description on the left, control on
 * the right. Pass `stacked` when the control is tall (e.g. textarea) — then the
 * control goes below.
 */
export function SettingsRow({
  label,
  description,
  children,
  stacked = false,
}: {
  label: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  stacked?: boolean
}) {
  return (
    <div
      className={cn(
        "flex gap-4 py-3 border-b border-border/30 last:border-b-0",
        stacked ? "flex-col" : "items-center justify-between"
      )}
    >
      <div className={cn("flex flex-col min-w-0", !stacked && "flex-1")}>
        <div className="text-sm font-medium truncate">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
        )}
      </div>
      {children !== undefined && (
        <div className={cn("flex-shrink-0", stacked ? "w-full" : "")}>
          {children}
        </div>
      )}
    </div>
  )
}

/** Compact password input with show/hide toggle, sized for a SettingsRow control. */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  highlight,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  highlight?: boolean
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative w-56">
      <Input
        ref={inputRef}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        data-bwignore="true"
        data-form-type="other"
        className={cn(
          // Extra right padding to accommodate both Clear and Show/Hide buttons.
          "pr-16 font-mono",
          highlight && "border-red-500 focus:border-red-500 focus:ring-red-500/30"
        )}
      />
      {/* Clear button (only shown when there's a value) */}
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear value"
          title="Clear"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-label={show ? "Hide value" : "Show value"}
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/** Inline clickable <code> that copies to clipboard and shows a brief check. */
export function CopyCode({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard(1500)
  return (
    <code
      onClick={() => copy(text)}
      className="cursor-pointer inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent"
    >
      {copied ? <Check className="h-2.5 w-2.5 text-green-500" /> : <Copy className="h-2.5 w-2.5" />}
      {text}
    </code>
  )
}

/**
 * Generic on/off switch styled to match the settings UI. Used in Git,
 * Notifications, and the auto-detect toggle inside the API Keys section.
 */
export function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-primary" : "bg-input"
      )}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  )
}

/** Mobile-only section header shown above each section when stacked vertically. */
export function MobileSectionHeader({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <h3 className="flex items-center gap-2 font-semibold text-base mb-2">
      <Icon className="h-5 w-5" />
      {label}
    </h3>
  )
}
