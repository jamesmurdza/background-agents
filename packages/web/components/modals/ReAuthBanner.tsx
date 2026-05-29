"use client"

import { AlertTriangle, Github, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { signInWithGitHub } from "@/lib/auth-utils"

interface ReAuthBannerProps {
  open: boolean
  onDismiss: () => void
  isMobile?: boolean
}

/**
 * Non-blocking corner notification shown when the GitHub access token
 * stored in the session has expired or been revoked. The user can keep
 * using non-GitHub features (so this is intentionally a banner, not a
 * modal: no backdrop, no focus trap, no click interception).
 *
 * Previously implemented as a Radix Dialog with a full-viewport
 * overlay, which blocked interaction with the rest of the app — a
 * particular pain when the underlying token check is occasionally
 * wrong (e.g. transient GitHub 5xx flagged as a 401 elsewhere).
 */
export function ReAuthBanner({ open, onDismiss, isMobile = false }: ReAuthBannerProps) {
  if (!open) return null

  const handleReAuth = () => {
    signInWithGitHub()
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="reauth-banner"
      className={cn(
        // Bottom-right toast; on mobile, full-width pinned to the bottom.
        // z-40 keeps it below modal dialogs (z-50) so it never blocks them.
        "fixed z-40 rounded-lg border border-border bg-popover shadow-lg",
        isMobile
          ? "inset-x-3 bottom-3 p-3"
          : "right-4 bottom-4 w-[22rem] p-4"
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={cn("font-medium", isMobile ? "text-sm" : "text-sm")}>
              GitHub authorization expired
            </p>
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className={cn("mt-1 text-muted-foreground", isMobile ? "text-xs" : "text-xs")}>
            Re-authorize to keep using repositories, branches, and PRs.
          </p>
          <button
            onClick={handleReAuth}
            className={cn(
              "mt-3 inline-flex items-center justify-center gap-2 rounded-md bg-[#24292f] text-white hover:bg-[#24292f]/90 active:bg-[#24292f]/80 transition-colors font-medium cursor-pointer",
              isMobile ? "px-4 py-2 text-sm" : "px-3 py-1.5 text-xs"
            )}
          >
            <Github className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            Authorize with GitHub
          </button>
        </div>
      </div>
    </div>
  )
}
