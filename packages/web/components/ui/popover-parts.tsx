"use client"

import { Loader2, Copy, Check } from "lucide-react"
import { cn } from "@/lib/utils"

// =============================================================================
// Popover UI Components - Shared between the Deploy and Share header popovers
// =============================================================================

/** Icon + title row at the top of a popover. */
export function PopoverHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
      {icon}
      {title}
    </div>
  )
}

/** Small muted description line under the header. */
export function PopoverDescription({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs text-muted-foreground">{children}</p>
}

/** Readonly value row with an optional copy button and optional external link. */
export function CopyableField({
  value,
  href,
  copied = false,
  onCopy,
}: {
  value: string
  href?: string
  copied?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-primary hover:underline"
        >
          {value}
        </a>
      ) : (
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground outline-none"
        />
      )}
      {onCopy && (
        <button
          onClick={onCopy}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          title="Copy link"
          aria-label="Copy link"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  )
}

/** Primary action button for popovers - green, matching the "connected/active" trigger color. */
export function PopoverPrimaryButton({
  onClick,
  disabled = false,
  loading = false,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mt-3 flex justify-end">
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className={cn(
          "flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white",
          "hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
        )}
      >
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {!loading && icon}
        {children}
      </button>
    </div>
  )
}

/** Secondary/destructive text action, e.g. "Stop sharing". */
export function PopoverTextButton({
  onClick,
  disabled = false,
  loading = false,
  icon,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="mt-3 flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors cursor-pointer disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}
