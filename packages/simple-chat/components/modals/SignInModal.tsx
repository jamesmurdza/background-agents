"use client"

import { signIn } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { X, Github, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"

interface SignInModalProps {
  open: boolean
  onClose: () => void
  isMobile?: boolean
}

export function SignInModal({ open, onClose, isMobile = false }: SignInModalProps) {
  const handleSignIn = () => {
    signIn("github")
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/50",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-lg shadow-lg"
          )}
        >
          {/* Header */}
          <div className={cn(
            "flex items-center justify-between border-b border-border bg-popover",
            isMobile ? "px-4 py-3" : "px-4 py-3"
          )}>
            <Dialog.Title className={cn(
              "font-semibold flex items-center gap-2",
              isMobile ? "text-lg" : "text-sm"
            )}>
              <MessageSquare className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
              Sign in to continue
            </Dialog.Title>
            <Dialog.Close className={cn(
              "rounded-lg hover:bg-accent active:bg-accent transition-colors touch-target",
              isMobile ? "p-2 -mr-2" : "p-1"
            )}>
              <X className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className={cn(
            "flex flex-col items-center text-center",
            isMobile ? "p-6 space-y-4" : "p-6 space-y-4"
          )}>
            <p className={cn(
              "text-muted-foreground",
              isMobile ? "text-base" : "text-sm"
            )}>
              Sign in with GitHub to start chatting with AI agents. Your message will be sent automatically after signing in.
            </p>

            <button
              onClick={handleSignIn}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-md bg-[#24292f] text-white hover:bg-[#24292f]/90 active:bg-[#24292f]/80 transition-colors font-medium",
                isMobile ? "px-6 py-3 text-base" : "px-4 py-2.5 text-sm"
              )}
            >
              <Github className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
              Sign in with GitHub
            </button>
          </div>

          {/* Footer */}
          <div className={cn(
            "flex justify-center border-t border-border bg-popover",
            isMobile ? "px-4 py-3" : "px-4 py-3"
          )}>
            <button
              onClick={onClose}
              className={cn(
                "text-muted-foreground hover:text-foreground transition-colors",
                isMobile ? "text-sm" : "text-xs"
              )}
            >
              Cancel
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
