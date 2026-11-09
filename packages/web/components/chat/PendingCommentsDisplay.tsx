"use client"

import { X } from "lucide-react"
import { useChatCommentsStore } from "@/lib/stores/chat-comments-store"
import { cn } from "@/lib/utils"

/** Comments waiting to be sent, as cards like the attached files next to them. */
export function PendingCommentsDisplay({ chatId, isMobile = false }: { chatId: string; isMobile?: boolean }) {
  const comments = useChatCommentsStore((state) => state.byChat[chatId])
  const removeComment = useChatCommentsStore((state) => state.removeComment)
  if (!comments?.length) return null

  return (
    <div className={cn("flex flex-wrap gap-2", isMobile ? "px-3 pt-3 pb-1" : "px-4 pt-3 pb-1")}>
      {comments.map((c) => (
        <div
          key={c.id}
          className="relative w-[180px] rounded-lg border border-border bg-muted/30 px-2.5 py-2"
          title={`${c.context}\n\n${c.comment}`}
        >
          <p className="truncate font-mono text-[11px] text-muted-foreground">{c.label}</p>
          <p className="mt-1 line-clamp-3 text-xs">{c.comment}</p>
          <button
            type="button"
            onClick={() => removeComment(chatId, c.id)}
            className={cn(
              "absolute flex items-center justify-center rounded-full bg-background/80 hover:bg-background text-muted-foreground hover:text-foreground transition-colors shadow-sm cursor-pointer",
              isMobile ? "h-5 w-5 -top-2 -left-2" : "h-4 w-4 -top-1.5 -left-1.5"
            )}
            aria-label={`Remove comment on ${c.label}`}
          >
            <X className={cn(isMobile ? "h-3 w-3" : "h-2.5 w-2.5")} />
          </button>
        </div>
      ))}
    </div>
  )
}
