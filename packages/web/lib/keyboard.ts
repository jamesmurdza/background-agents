/**
 * Cross-platform "mod key" helpers for keyboard shortcuts.
 *
 * On macOS, Ctrl is not a modifier convention (Cmd/Meta is), so we only treat
 * Meta as the mod key there. On Windows/Linux, Ctrl remains the mod key (and
 * we keep accepting Meta too, in case a browser reports the Windows/Super key
 * as `metaKey`).
 */

/** Detect macOS from the browser environment. Returns false outside the browser. */
function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false
  // `navigator.platform` is deprecated but still the most broadly supported
  // signal; fall back to userAgentData/userAgent where available.
  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || ""
  return /mac/i.test(platform)
}

/**
 * Whether the event's mod key (Cmd on macOS, Ctrl elsewhere) is held.
 * On macOS, Ctrl is intentionally ignored; on other platforms both Ctrl and
 * Meta are accepted.
 */
export function isModKeyPressed(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMacPlatform() ? e.metaKey : e.metaKey || e.ctrlKey
}
