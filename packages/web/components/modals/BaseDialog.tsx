"use client"

import { useRef } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"
import { useDragToClose } from "@/lib/hooks/useDragToClose"
import { cn } from "@/lib/utils"

// ============================================================================
// BaseDialog - Shared dialog component for git operations
// ============================================================================

export interface BaseDialogProps {
  open: boolean
  onClose: () => void
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  isMobile?: boolean
  /** When true, content area allows overflow (for dropdowns) */
  allowOverflow?: boolean
  /** Ref to the element that should receive focus when dialog opens */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export function BaseDialog({ open, onClose, title, icon, children, isMobile = false, allowOverflow = false, initialFocusRef }: BaseDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null)

  // Drag to dismiss (mobile only)
  const { handlers: dragHandlers, dragY, isDragging } = useDragToClose({
    onClose,
    enabled: isMobile,
  })

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px]" />
        <Dialog.Content
          onOpenAutoFocus={(e) => {
            if (initialFocusRef?.current) {
              e.preventDefault()
              initialFocusRef.current.focus()
            }
          }}
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover flex flex-col",
            // Allow overflow when dropdowns are open so they're not clipped
            allowOverflow ? "overflow-visible" : "overflow-hidden",
            isMobile
              ? "inset-x-0 bottom-0 rounded-t-2xl max-h-[85vh]"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm border border-border rounded-lg shadow-xl",
            !isDragging && isMobile && "transition-transform duration-300"
          )}
          style={isMobile ? { transform: `translateY(${dragY}px)` } : undefined}
        >
          {/* Draggable header area */}
          <div {...dragHandlers}>
            {isMobile && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>
            )}

            <ModalHeader
              title={
                <>
                  {icon}
                  {title}
                </>
              }
            />
          </div>

          <div ref={contentRef} className={cn(
            "flex-1",
            isMobile ? "p-4" : "p-4",
            // Allow overflow when dropdowns are open so they're not clipped
            allowOverflow ? "overflow-visible" : "overflow-y-auto"
          )}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
