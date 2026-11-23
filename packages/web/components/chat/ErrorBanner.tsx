"use client"

import { useState, useRef, useLayoutEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

interface ErrorBannerProps {
  message: string
  isMobile?: boolean
  /** The recovery action (resend the message, or reload the chat history). The
   *  banner unmounts on its own when the parent sees the chat leave its failed
   *  status. */
  onRetry?: () => Promise<void> | void
  /** Label for the action button. Defaults to "Retry". */
  actionLabel?: string
  /** Label shown while the action is running. Defaults to "Retrying…". */
  actionPendingLabel?: string
  /** Where a "Report issue" link points (opens in a new tab), for failures a
   *  retry didn't fix. No link when omitted. */
  reportHref?: string
}

export function ErrorBanner({
  message,
  isMobile,
  onRetry,
  actionLabel = "Retry",
  actionPendingLabel = "Retrying…",
  reportHref,
}: ErrorBannerProps) {
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    setOverflow(el.scrollHeight > el.clientHeight + 1)
  }, [message, expanded])

  const handleRetry = async () => {
    if (!onRetry || isRetrying) return
    setIsRetrying(true)
    try { await onRetry() } finally { setIsRetrying(false) }
  }

  return (
    <div
      data-testid="chat-error-banner"
      className={cn(
        // Negative top margin only when there's a preceding sibling, so the
        // banner sits flush against the last message instead of inheriting
        // the messages container's space-y gap.
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 text-destructive",
        isMobile
          ? "[&:not(:first-child)]:-mt-4 px-3 py-2 text-sm"
          : "[&:not(:first-child)]:-mt-6 px-3 py-2 text-[13px]"
      )}
    >
      <AlertTriangle className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
      <div className="min-w-0 flex-1">
        <div
          ref={contentRef}
          className={cn(
            "break-words whitespace-pre-wrap",
            !expanded && (isMobile ? "max-h-32 overflow-hidden" : "max-h-24 overflow-hidden")
          )}
        >
          {message}
        </div>
        <div className="mt-1 flex items-center gap-3">
          {(overflow || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="underline underline-offset-2 hover:no-underline cursor-pointer"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              data-testid="chat-error-retry"
              onClick={handleRetry}
              disabled={isRetrying}
              className="underline underline-offset-2 hover:no-underline cursor-pointer disabled:cursor-default disabled:no-underline disabled:opacity-70"
            >
              {isRetrying ? actionPendingLabel : actionLabel}
            </button>
          )}
          {reportHref && (
            <a
              data-testid="chat-error-report"
              href={reportHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:no-underline cursor-pointer"
            >
              Report issue
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
