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
