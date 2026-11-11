/** Fixed size for every OAuth/connect popup opened across the app. */
const OAUTH_POPUP_FEATURES = "width=600,height=700,scrollbars=yes"

/**
 * Opens a same-sized OAuth/connect popup and returns it, or `null` if the
 * browser blocked the popup (or it was closed synchronously). Callers should
 * bail out on `null` rather than proceeding to poll a popup that never opened.
 */
export function openOAuthPopup(url: string, windowName: string): Window | null {
  const popup = window.open(url, windowName, OAUTH_POPUP_FEATURES)
  return popup && !popup.closed ? popup : null
}

/**
 * Starts polling `popup` every `intervalMs` until it's closed (or, when
 * `messageSource` is given, until a `postMessage` with that `source` arrives
 * first), then invokes `onClose` exactly once. Returns the interval handle so
 * the caller can cancel early, e.g. on unmount.
 */
export function pollUntilPopupCloses(
  popup: Window,
  onClose: () => void,
  opts?: { intervalMs?: number; messageSource?: string }
): ReturnType<typeof setInterval> {
  const intervalMs = opts?.intervalMs ?? 500
  const messageSource = opts?.messageSource
  let finished = false

  function onMessage(e: MessageEvent) {
    const data = e.data as { source?: string } | null
    if (data?.source === messageSource) finish()
  }

  function finish() {
    if (finished) return
    finished = true
    clearInterval(timer)
    if (messageSource) window.removeEventListener("message", onMessage)
    onClose()
  }

  if (messageSource) window.addEventListener("message", onMessage)
  const timer = setInterval(() => {
    if (popup.closed) finish()
  }, intervalMs)
  return timer
}
