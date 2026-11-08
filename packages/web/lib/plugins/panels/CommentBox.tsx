"use client"

import { useEffect, useRef, useState } from "react"
import { Textarea } from "@/components/ui/textarea"
import { useChatSyncStore } from "@/lib/stores/chat-sync-store"
import { COMMENT_BOX_WIDTH } from "@/lib/element-picker"
import { cn } from "@/lib/utils"

/** Adds `text` to the chat input, after whatever is there, so several comments can be sent together. */
export function addToChatDraft(chatId: string, text: string) {
  const store = useChatSyncStore.getState()
  const draft = store.localChatState.drafts[chatId]
  store.setDraftText(chatId, draft ? `${draft}\n\n${text}` : text)
}

/**
 * The "What should change?" box for Select element in the Live Preview and for
 * lines in the Changes panel. `label` shows what the comment is about.
 */
export function CommentBox({
  label,
  target,
  onAdd,
  onCancel,
  className,
  style,
}: {
  label: string
  /** What the box is attached to; when it changes, the input is focused again and the text kept. */
  target: unknown
  onAdd: (comment: string) => void
  onCancel: () => void
  className?: string
  style?: React.CSSProperties
}) {
  const [comment, setComment] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => inputRef.current?.focus(), [target])
  const add = () => comment.trim() && onAdd(comment)

  return (
    <div
      className={cn("rounded-md border border-border bg-popover p-2 shadow-lg", className)}
      style={{ width: COMMENT_BOX_WIDTH, ...style }}
    >
      <p className="mb-1.5 truncate font-mono text-[11px] text-muted-foreground" title={label}>
        {label}
      </p>
      <Textarea
        ref={inputRef}
        rows={2}
        value={comment}
        placeholder="What should change?"
        aria-label={`Comment on ${label}`}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            add()
          } else if (e.key === "Escape") {
            // Closes only the box; in the Live Preview a second Esc leaves select mode.
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
        >
          Cancel
        </button>
        <button
          onClick={add}
          disabled={!comment.trim()}
          className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors cursor-pointer"
        >
          Add to chat
        </button>
      </div>
    </div>
  )
}
