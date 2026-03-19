/**
 * Native browser notification utilities
 *
 * Handles requesting permissions and showing notifications for important events
 * like agent completion or errors.
 */

/** Check if notifications are supported and permitted */
export function canNotify(): boolean {
  if (typeof window === "undefined") return false
  if (!("Notification" in window)) return false
  return Notification.permission === "granted"
}

/** Check if notifications are supported (regardless of permission) */
export function notificationsSupported(): boolean {
  if (typeof window === "undefined") return false
  return "Notification" in window
}

/** Get current permission state */
export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationsSupported()) return "unsupported"
  return Notification.permission
}

/**
 * Request notification permission from user
 * Returns true if permission was granted
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === "granted") return true
  if (Notification.permission === "denied") return false

  try {
    const result = await Notification.requestPermission()
    return result === "granted"
  } catch {
    return false
  }
}

interface NotifyOptions {
  title: string
  body?: string
  /** Tag to replace existing notification with same tag */
  tag?: string
  /** Click handler - defaults to focusing the window */
  onClick?: () => void
}

/**
 * Show a native notification
 *
 * If permission hasn't been granted, this will silently do nothing.
 * Call requestNotificationPermission() first to ensure permission.
 */
export function notify({ title, body, tag, onClick }: NotifyOptions): Notification | null {
  if (!canNotify()) return null

  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: "/android-chrome-192x192.png",
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
      onClick?.()
    }

    return notification
  } catch {
    return null
  }
}

/**
 * Notify that an agent has completed its task
 */
export function notifyAgentComplete(branchName: string): Notification | null {
  return notify({
    title: "Agent finished",
    body: `Task completed on ${branchName}`,
    tag: `agent-complete-${branchName}`,
  })
}

/**
 * Notify that an agent encountered an error
 */
export function notifyAgentError(branchName: string, error?: string): Notification | null {
  return notify({
    title: "Agent error",
    body: error ? `${branchName}: ${error}` : `Something went wrong on ${branchName}`,
    tag: `agent-error-${branchName}`,
  })
}
