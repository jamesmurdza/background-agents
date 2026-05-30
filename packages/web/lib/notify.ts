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
}

export function notify({ title, body, chatId }: NotifyOptions): void {
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
 * Convenience helper for "a new push that contains commits" notifications.
 */
/**
 * Convenience helper for "an agent turn finished" notifications.
 */
export function notifyAgentFinished(info: {
  chatName?: string
  status: "completed" | "error"
  chatId?: string
}): void {
  const { chatName, status, chatId } = info
  const label = chatName ? `"${chatName}"` : "Your agent"
  notify({
    title: status === "error" ? "Agent failed" : "Agent finished",
    body:
      status === "error"
        ? `${label} stopped with an error.`
        : `${label} finished its turn.`,
    chatId,
  })
}

export function notifyPush(info: {
  repo?: string
  branch: string
  commits: number
  commitSha?: string
  chatId?: string
}): void {
  const { repo, branch, commits, commitSha, chatId } = info
  const plural = commits === 1 ? "commit" : "commits"
  const target = repo ? `${repo}@${branch}` : branch
  const shaSuffix = commitSha ? ` (${commitSha})` : ""
  notify({
    title: "New push",
    body: `${commits} ${plural} pushed to ${target}${shaSuffix}`,
    chatId,
  })
}
