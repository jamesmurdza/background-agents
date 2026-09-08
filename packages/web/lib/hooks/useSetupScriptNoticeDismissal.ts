"use client"

import { useState } from "react"
import { readJSON, writeJSON } from "@/lib/storage"
import { scriptNoticeDismissalKey } from "@/lib/setup-script-notice"

/**
 * Whether the current chat's setup-script-updated notice has been dismissed,
 * and a way to dismiss it.
 *
 * Read once per (chatId, scriptHash) pair in render rather than an effect,
 * matching useCreditWarning: an effect would flash the notice for one frame
 * on every mount that already has a dismissal on record.
 */
export function useSetupScriptNoticeDismissal(chatId: string, scriptHash: string) {
  const id = `${chatId}:${scriptHash}`
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  if (scriptHash && loadedFor !== id) {
    setLoadedFor(id)
    setDismissed(readJSON(scriptNoticeDismissalKey(chatId, scriptHash), false, "setup script notice dismissal"))
  }

  const dismiss = () => {
    if (!scriptHash) return
    writeJSON(scriptNoticeDismissalKey(chatId, scriptHash), true, "setup script notice dismissal")
    setDismissed(true)
  }

  return { dismissed, dismiss }
}
