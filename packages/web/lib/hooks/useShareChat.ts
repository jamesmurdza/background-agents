"use client"

import { useState } from "react"
import { notify } from "@/lib/notify"

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
      setShareId(data.shareId)
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
      setShareId(null)
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
