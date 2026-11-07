"use client"

import { useState } from "react"
import { Share2, Globe, Link2Off } from "lucide-react"
import { cn } from "@/lib/utils"
import { useShareChat } from "@/lib/hooks/useShareChat"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import {
  PopoverHeader,
  PopoverDescription,
  CopyableField,
  PopoverPrimaryButton,
  PopoverTextButton,
} from "@/components/ui/popover-parts"

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
        <PopoverHeader icon={<Globe className="h-4 w-4 text-muted-foreground" />} title="Share chat" />

        {shareId ? (
          <>
            <PopoverDescription>
              Anyone with this link can view this chat read-only. New messages
              stay visible as the chat continues.
            </PopoverDescription>
            <CopyableField value={shareUrl} copied={copied} onCopy={copyLink} />
            <PopoverTextButton onClick={revokeShare} loading={busy} icon={<Link2Off className="h-3.5 w-3.5" />}>
              Stop sharing
            </PopoverTextButton>
          </>
        ) : (
          <>
            <PopoverDescription>
              Create a public link so anyone can view this chat read-only.
            </PopoverDescription>
            <PopoverPrimaryButton onClick={enableShare} loading={busy}>
              Create public link
            </PopoverPrimaryButton>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
