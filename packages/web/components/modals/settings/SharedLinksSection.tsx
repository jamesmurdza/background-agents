"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Copy, Check, Globe, Link2Off, Loader2 } from "lucide-react"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { useCopyToClipboard } from "@/lib/hooks/useCopyToClipboard"
import { useSharedChatsQuery, type SharedChatInfo } from "@/lib/query/hooks/useSharedChatsQuery"
import { queryKeys } from "@/lib/query/keys"
import { MobileSectionHeader } from "./shared"

/** The user's chats with an active public share link, with a way to revoke them. */
export function SharedLinksSection({ isMobile }: { isMobile: boolean }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useSharedChatsQuery()
  const [confirming, setConfirming] = useState<SharedChatInfo | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function revoke(chat: SharedChatInfo) {
    setRevokingId(chat.id)
    setError(null)
    try {
      const res = await fetch(`/api/chats/${chat.id}/share`, { method: "DELETE" })
      if (!res.ok) throw new Error("Couldn't revoke the link")
      queryClient.setQueryData<{ chats: SharedChatInfo[] }>(queryKeys.chats.shared(), (prev) =>
        prev ? { chats: prev.chats.filter((c) => c.id !== chat.id) } : prev
      )
      // Keep the sidebar/header in sync — they read shareId off the chats list/detail caches.
      queryClient.setQueryData<{ id: string; shareId: string | null }[]>(queryKeys.chats.list(), (prev) =>
        prev?.map((c) => (c.id === chat.id ? { ...c, shareId: null } : c))
      )
      queryClient.setQueryData<{ shareId: string | null }>(queryKeys.chats.detail(chat.id), (prev) =>
        prev ? { ...prev, shareId: null } : prev
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Globe} label="Shared Links" />}
      <p className="mb-3 text-xs text-muted-foreground">
        Chats with a public read-only link. Anyone with the link can view the chat
        as it continues; revoking a link breaks it immediately.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.chats.length ? (
        <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
          No chats are shared publicly.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.chats.map((chat) => (
            <SharedLinkRow
              key={chat.id}
              chat={chat}
              busy={revokingId === chat.id}
              onRevoke={() => setConfirming(chat)}
            />
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && revoke(confirming)}
        title={`Stop sharing "${confirming?.displayName ?? "Untitled"}"?`}
        description="Anyone with the link will immediately lose access to this chat."
        confirmLabel="Stop sharing"
        variant="destructive"
        isMobile={isMobile}
      />
    </div>
  )
}

function SharedLinkRow({
  chat,
  busy,
  onRevoke,
}: {
  chat: SharedChatInfo
  busy: boolean
  onRevoke: () => void
}) {
  const { copied, copy } = useCopyToClipboard(1500)
  const origin =
    typeof window !== "undefined"
      ? (window as { BACKGROUND_AGENTS_API_URL?: string }).BACKGROUND_AGENTS_API_URL ||
        window.location.origin
      : ""
  const shareUrl = origin ? `${origin}/share/${chat.shareId}` : ""

  return (
    <li className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{chat.displayName || "Untitled"}</div>
        <div className="truncate text-xs text-muted-foreground">{shareUrl}</div>
      </div>
      <button
        type="button"
        onClick={() => copy(shareUrl)}
        disabled={!shareUrl}
        aria-label="Copy link"
        title="Copy link"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground disabled:cursor-default"
      >
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={onRevoke}
        disabled={busy}
        aria-label="Stop sharing"
        title="Stop sharing"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-destructive disabled:cursor-default"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2Off className="h-4 w-4" />}
      </button>
    </li>
  )
}
