"use client"

import { useCallback, useRef, useEffect } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"

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
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = useCallback(() => {
    onConfirm()
    onClose()
  }, [onConfirm, onClose])

  // Focus the confirm button when modal opens
  useEffect(() => {
    if (open) {
      // Small delay to ensure the modal is fully rendered
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            confirmButtonRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
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
                ref={confirmButtonRef}
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
