"use client"

import { useEffect } from "react"

/**
 * Locks page scroll (`document.body.style.overflow = "hidden"`) while
 * `locked` is true — used by drawers/sheets/modals that overlay the page.
 * Restores scroll on unmount or once `locked` goes false.
 *
 * Note: this sets `document.body.style.overflow` directly rather than
 * reference-counting, so two instances locked at once can clobber each
 * other's cleanup (same pre-existing behavior as before this was shared).
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (locked) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [locked])
}
