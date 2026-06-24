import { cn } from "@/lib/utils"

interface ChatPanelSkeletonProps {
  isMobile: boolean
  /** Width class for the header title placeholder (e.g. "w-40"). */
  titleWidth: string
  /** Width class for the card's inner title placeholder (e.g. "w-1/3"). */
  headerWidth: string
}

/**
 * Animated placeholder shown while a chat is being created (no chat yet) or its
 * messages are still loading. The two call sites differ only in the two width
 * classes, so they're parameterized.
 */
export function ChatPanelSkeleton({ isMobile, titleWidth, headerWidth }: ChatPanelSkeletonProps) {
  return (
    <div className="flex-1 flex flex-col bg-background min-h-0 animate-pulse">
      {!isMobile && (
        <div className="pt-3 pl-[1.625rem] pr-4">
          <div className={cn("h-6 rounded bg-muted", titleWidth)} />
        </div>
      )}
      <div className="flex-1" />
      <div className={cn(
        "w-full mx-auto",
        isMobile ? "max-w-full px-3 pb-3" : "max-w-[52rem] px-4 pb-4"
      )}>
        <div className={cn(
          "flex flex-col border border-border bg-card shadow-sm",
          isMobile ? "rounded-xl" : "rounded-2xl"
        )}>
          <div className={cn(isMobile ? "px-3 py-3" : "px-4 py-3")}>
            <div className={cn("h-5 rounded bg-muted", headerWidth)} />
          </div>
          <div className={cn(
            "flex items-center gap-2 border-t border-border",
            isMobile ? "px-3 py-2" : "px-4 py-2"
          )}>
            <div className="h-6 w-20 rounded bg-muted" />
            <div className="h-6 w-24 rounded bg-muted" />
            <div className="flex-1" />
            <div className={cn("rounded-md bg-muted", isMobile ? "h-9 w-9" : "h-7 w-7")} />
          </div>
        </div>
      </div>
    </div>
  )
}
