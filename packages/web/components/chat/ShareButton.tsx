"use client"

import { useState } from "react"
import { Share2, Copy, Check, Loader2, Globe, Link2Off } from "lucide-react"
import { cn } from "@/lib/utils"
import { useShareChat } from "@/lib/hooks/useShareChat"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"

// =============================================================================
// ShareButton — create / copy / revoke a public read-only link for a chat
// =============================================================================
//
// The public link (/share/<shareId>) shows the chat's current messages
// read-only — tool calls and outputs are visible, but file references render
// as plain text rather than links. It's a live view: new messages appear on
// the link as the chat continues.

interface ShareButtonProps {
  chatId: string
  /** Current share token from the chat row (null/undefined = not shared). */
  initialShareId?: string | null
}

export function ShareButton({ chatId, initialShareId }: ShareButtonProps) {
  const [open, setOpen] = useState(false)
  const { shareId, busy, copied, shareUrl, enableShare, revokeShare, copyLink } =
    useShareChat(chatId, initialShareId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer",
            shareId
              ? "text-green-500 hover:bg-green-500/10"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={shareId ? "Chat is shared publicly" : "Share chat"}
          aria-label="Share chat"
        >
          <Share2 className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Share chat
        </div>

        {shareId ? (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Anyone with this link can view this chat read-only. New messages
              stay visible as the chat continues.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground outline-none"
              />
              <button
                onClick={copyLink}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                title="Copy link"
                aria-label="Copy link"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <button
              onClick={revokeShare}
              disabled={busy}
              className="mt-3 flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors cursor-pointer disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2Off className="h-3.5 w-3.5" />
              )}
              Stop sharing
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-xs text-muted-foreground">
              Create a public link so anyone can view this chat read-only.
            </p>
            <button
              onClick={enableShare}
              disabled={busy}
              className="mt-3 flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90 transition-colors cursor-pointer disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
              Create public link
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
