"use client"

import { useCallback } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { ModalHeader } from "@/components/ui/modal-header"

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: "default" | "destructive"
  isMobile?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  isMobile = false,
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't trigger if user is typing in form fields
    const target = e.target as HTMLElement
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      return
    }

    if (e.key === "Enter") {
      e.preventDefault()
      handleConfirm()
    }
  }, [handleConfirm])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          onKeyDown={handleKeyDown}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-xl shadow-xl"
          )}
        >
          <ModalHeader title={title} />
          <div className="px-4 pt-3 pb-4 space-y-4 text-sm">
            {description && (
              <div className="text-muted-foreground">{description}</div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-md hover:bg-accent transition-colors px-3 py-1.5 text-sm cursor-pointer"
              >
                {cancelLabel}
              </button>
              <button
                onClick={handleConfirm}
                className={cn(
                  "rounded-md transition-colors px-3 py-1.5 text-sm cursor-pointer",
                  variant === "destructive"
                    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
