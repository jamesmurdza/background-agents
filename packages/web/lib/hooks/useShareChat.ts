"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { notify } from "@/lib/notify"
import { queryKeys } from "@/lib/query"
import type { Chat } from "@/lib/types"

// =============================================================================
// useShareChat — create / copy / revoke a chat's public read-only link
// =============================================================================
//
// Shared by the desktop ShareButton (popover) and the mobile commands sheet.
// Callers should key the host component by chatId so internal state resets when
// the user switches chats.

export function useShareChat(chatId: string, initialShareId?: string | null) {
  const [shareId, setShareId] = useState<string | null>(initialShareId ?? null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()

  // Update local state AND the React Query caches so the new share status is
  // visible everywhere immediately — the sidebar/header read shareId from the
  // chats list cache, and the chat-actions dialog reads it from there too.
  // Without this they stay stale until the next refetch (a page refresh).
  const applyShareId = (newShareId: string | null) => {
    setShareId(newShareId)
    queryClient.setQueryData<Chat[]>(queryKeys.chats.list(), (prev) =>
      prev?.map((c) => (c.id === chatId ? { ...c, shareId: newShareId } : c))
    )
    queryClient.setQueryData<Chat>(queryKeys.chats.detail(chatId), (prev) =>
      prev ? { ...prev, shareId: newShareId } : prev
    )
  }

  // Build the link against the hosted backend origin when one is configured
  // (the Electron desktop app sets BACKGROUND_AGENTS_API_URL — without this the
  // link would be a useless `app://./share/...`). On the plain web app this is
  // empty, so we fall back to the current origin (correct host in prod).
  const origin =
    typeof window !== "undefined"
      ? (window as { BACKGROUND_AGENTS_API_URL?: string }).BACKGROUND_AGENTS_API_URL ||
        window.location.origin
      : ""
  const shareUrl = shareId && origin ? `${origin}/share/${shareId}` : ""

  const enableShare = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/share`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to create link")
      const data = (await res.json()) as { shareId: string }
      applyShareId(data.shareId)
    } catch {
      notify({ title: "Couldn't create share link" })
    } finally {
      setBusy(false)
    }
  }

  const revokeShare = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/share`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to revoke link")
      applyShareId(null)
    } catch {
      notify({ title: "Couldn't revoke share link" })
    } finally {
      setBusy(false)
    }
  }

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      notify({ title: "Couldn't copy link" })
    }
  }

  return { shareId, busy, copied, shareUrl, enableShare, revokeShare, copyLink }
}
