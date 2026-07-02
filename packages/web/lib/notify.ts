/**
 * Cross-environment notifications.
 *
 * - In the Electron desktop app: shows a native OS notification (clicking it
 *   focuses the window and navigates to the chat).
 * - In the browser: shows an in-app toast.
 *
 * This is a plain module (not a hook) so it can be called from anywhere,
 * including inside event-source callbacks.
 */

import { getElectronAPI } from "@/lib/hooks/useElectron"
import { useToastStore } from "@/lib/stores/toast-store"

export interface NotifyOptions {
  title: string
  body?: string
  /** Chat to focus/navigate to when the notification is clicked */
  chatId?: string
  /** Play a short notification sound */
  sound?: boolean
}

/**
 * Play a short notification chime using the Web Audio API, so we don't need
 * to ship an audio asset. Best-effort: silently no-ops if audio is
 * unavailable or blocked (e.g. before the user has interacted with the page).
 */
function playNotificationSound(): void {
  if (typeof window === "undefined") return
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime

    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    // Quick fade in/out to avoid clicks.
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)

    const osc = ctx.createOscillator()
    osc.type = "sine"
    // Two-note rising chime.
    osc.frequency.setValueAtTime(660, now)
    osc.frequency.setValueAtTime(880, now + 0.12)
    osc.connect(gain)
    osc.start(now)
    osc.stop(now + 0.36)
    osc.onended = () => ctx.close().catch(() => {})
  } catch {
    // Ignore — sound is a nice-to-have.
  }
}

export function notify({ title, body, chatId, sound }: NotifyOptions): void {
  if (sound) playNotificationSound()

  const electron = getElectronAPI()

  if (electron) {
    // Native local notification in the desktop app
    electron.showNotification({ title, body: body ?? "", chatId })
    return
  }

  // Browser: in-app toast
  useToastStore.getState().addToast({ title, body, chatId })
}

/**
 * Format the "N commits pushed to <target> (sha)" fragment. Prefers the chat's
 * human-friendly name over the git branch; falls back to repo@branch (or the
 * bare branch) only when no chat name is available.
 */
function formatPush(
  push: {
    repo?: string
    branch: string
    commits: number
    commitSha?: string
  },
  chatName?: string
): string {
  const target = chatName
    ? `"${chatName}"`
    : push.repo
    ? `${push.repo}@${push.branch}`
    : push.branch
  const shaSuffix = push.commitSha ? ` (${push.commitSha})` : ""
  // `commits` is best-effort; show the count when known, otherwise a generic
  // message (the push itself is confirmed by the git output).
  const lead =
    push.commits > 0
      ? `${push.commits} ${push.commits === 1 ? "commit" : "commits"} pushed`
      : "Changes pushed"
  return `${lead} to ${target}${shaSuffix}`
}

/**
 * Notify about an agent completion. Both the "finished" and "committed" facts
 * are delivered as a SINGLE notification when both apply — firing two separate
 * OS notifications in the same tick causes macOS to coalesce them (the second
 * silently replaces the first).
 */
export function notifyCompletion(info: {
  chatName?: string
  status: "completed" | "error"
  /** Whether the "agent finished" message should be included */
  finished: boolean
  /** Present when a push delivered changes and the user wants commit alerts */
  push?: { repo?: string; branch: string; commits: number; commitSha?: string }
  chatId?: string
  sound?: boolean
}): void {
  const { chatName, status, finished, push, chatId, sound } = info
  const label = chatName ? `"${chatName}"` : "Your agent"

  const parts: string[] = []
  let title: string
  if (status === "error") {
    // A failure dominates the headline; a push won't have happened on error.
    title = "Agent failed"
    parts.push(`${label} stopped with an error.`)
  } else if (finished) {
    title = "Agent finished"
    parts.push(`${label} finished its turn.`)
  } else {
    // Only the commit notification was requested.
    title = "New push"
  }

  if (push) parts.push(formatPush(push, chatName))

  notify({ title, body: parts.join(" · "), chatId, sound })
}
