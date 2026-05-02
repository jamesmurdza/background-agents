"use client"

import { signIn } from "next-auth/react"
import * as Dialog from "@radix-ui/react-dialog"
import { AlertTriangle, Github } from "lucide-react"
import { cn } from "@/lib/utils"
import { ModalHeader, focusChatPrompt } from "@/components/ui/modal-header"

interface ReAuthModalProps {
  open: boolean
  onClose: () => void
  isMobile?: boolean
}

/**
 * Shown when the GitHub access token stored in the session has expired
 * or been revoked. The user must re-authorize via OAuth to continue
 * using GitHub-dependent features (repos, branches, push, PRs, etc.).
 *
 * Mirrors the structure and styling of SignInModal but with re-auth
 * specific copy and a warning icon.
 */
export function ReAuthModal({ open, onClose, isMobile = false }: ReAuthModalProps) {
  const handleReAuth = () => {
    signIn("github")
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn(
          "fixed inset-0 z-50 transition-opacity duration-300 bg-black/15 backdrop-blur-[1px]",
          open ? "opacity-100" : "opacity-0"
        )} />
        <Dialog.Content
          onCloseAutoFocus={(e) => { e.preventDefault(); focusChatPrompt() }}
          className={cn(
            "fixed z-50 bg-popover overflow-hidden flex flex-col",
            isMobile
              ? "inset-x-4 top-1/2 -translate-y-1/2 rounded-xl"
              : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md border border-border rounded-lg shadow-xl"
          )}
        >
          <ModalHeader
            title={
              <>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                GitHub authorization expired
              </>
            }
          />

          {/* Content */}
          <div className={cn(
            "flex flex-col items-center text-center",
            isMobile ? "p-6 space-y-4" : "p-6 space-y-4"
          )}>
            <p className={cn(
              "text-muted-foreground",
              isMobile ? "text-base" : "text-sm"
            )}>
              Your GitHub access has expired or been revoked. Please authorize again to continue working with repositories, branches, and other GitHub features.
            </p>

            <button
              autoFocus
              onClick={handleReAuth}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-md bg-[#24292f] text-white hover:bg-[#24292f]/90 active:bg-[#24292f]/80 transition-colors font-medium cursor-pointer",
                isMobile ? "px-6 py-3 text-base" : "px-4 py-2.5 text-sm"
              )}
            >
              <Github className={cn(isMobile ? "h-5 w-5" : "h-4 w-4")} />
              Authorize with GitHub
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
                "text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                isMobile ? "text-sm" : "text-xs"
              )}
            >
              Dismiss
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
