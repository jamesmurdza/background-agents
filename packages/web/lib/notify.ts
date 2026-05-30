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
  console.log("[notify] dispatching:", { title, body, chatId, sound, channel: electron ? "electron" : "toast" })

  if (electron) {
    // Native local notification in the desktop app
    electron.showNotification({ title, body: body ?? "", chatId })
    return
  }

  // Browser: in-app toast
  useToastStore.getState().addToast({ title, body, chatId })
}

/**
 * Convenience helper for "an agent turn finished" notifications.
 */
export function notifyAgentFinished(info: {
  chatName?: string
  status: "completed" | "error"
  chatId?: string
  sound?: boolean
}): void {
  const { chatName, status, chatId, sound } = info
  const label = chatName ? `"${chatName}"` : "Your agent"
  notify({
    title: status === "error" ? "Agent failed" : "Agent finished",
    body:
      status === "error"
        ? `${label} stopped with an error.`
        : `${label} finished its turn.`,
    chatId,
    sound,
  })
}

export function notifyPush(info: {
  repo?: string
  branch: string
  commits: number
  commitSha?: string
  chatId?: string
  sound?: boolean
}): void {
  const { repo, branch, commits, commitSha, chatId, sound } = info
  const target = repo ? `${repo}@${branch}` : branch
  const shaSuffix = commitSha ? ` (${commitSha})` : ""
  // `commits` is best-effort; show the count when known, otherwise a generic
  // message (the push itself is confirmed by the git output).
  const lead = commits > 0 ? `${commits} ${commits === 1 ? "commit" : "commits"} pushed` : "Changes pushed"
  notify({
    title: "New push",
    body: `${lead} to ${target}${shaSuffix}`,
    chatId,
    sound,
  })
}
