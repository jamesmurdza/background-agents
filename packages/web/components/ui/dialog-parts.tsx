"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

// =============================================================================
// Dialog UI Components - Shared across git dialogs and other modal forms
// =============================================================================

/** Responsive label for form fields */
export function DialogLabel({ children, isMobile = false }: { children: React.ReactNode; isMobile?: boolean }) {
  return (
    <label className={cn(
      "block text-muted-foreground mb-1",
      isMobile ? "text-sm" : "text-xs"
    )}>
      {children}
    </label>
  )
}

/** Readonly display field for showing current values */
export function DialogReadonlyField({ children, isMobile = false }: { children: React.ReactNode; isMobile?: boolean }) {
  return (
    <div className={cn(
      "bg-muted/50 rounded-md px-3 font-medium truncate",
      isMobile ? "py-3 text-base" : "py-2 text-sm"
    )}>
      {children}
    </div>
  )
}

/** Standard cancel button for dialogs */
export function DialogCancelButton({ onClick, isMobile = false }: { onClick: () => void; isMobile?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md hover:bg-accent transition-colors",
        isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
      )}
    >
      Cancel
    </button>
  )
}

/** Standard primary action button for dialogs */
export interface DialogActionButtonProps {
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  isMobile?: boolean
  variant?: "primary" | "destructive"
  children: React.ReactNode
  buttonRef?: React.RefObject<HTMLButtonElement | null>
}

export function DialogActionButton({
  onClick,
  disabled = false,
  loading = false,
  isMobile = false,
  variant = "primary",
  children,
  buttonRef,
}: DialogActionButtonProps) {
  const variantClasses = variant === "destructive"
    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90"

  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "rounded-md disabled:opacity-50 flex items-center gap-2",
        variantClasses,
        isMobile ? "px-4 py-2.5 text-base" : "px-3 py-1.5 text-sm"
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

/** Standard footer with cancel and action buttons */
export interface DialogFooterProps {
  onCancel: () => void
  onAction: () => void
  actionLabel: string
  disabled?: boolean
  loading?: boolean
  isMobile?: boolean
  variant?: "primary" | "destructive"
  actionButtonRef?: React.RefObject<HTMLButtonElement | null>
}

export function DialogFooter({
  onCancel,
  onAction,
  actionLabel,
  disabled = false,
  loading = false,
  isMobile = false,
  variant = "primary",
  actionButtonRef,
}: DialogFooterProps) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <DialogCancelButton onClick={onCancel} isMobile={isMobile} />
      <DialogActionButton
        onClick={onAction}
        disabled={disabled}
        loading={loading}
        isMobile={isMobile}
        variant={variant}
        buttonRef={actionButtonRef}
      >
        {actionLabel}
      </DialogActionButton>
    </div>
  )
}

/** Responsive icon sizing for dialog headers */
export function dialogIconClass(isMobile: boolean): string {
  return isMobile ? "h-5 w-5" : "h-4 w-4"
}
