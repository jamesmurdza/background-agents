"use client"

import { useEffect } from "react"

/**
 * Closes a `[data-dropdown]`-marked dropdown when the user clicks anywhere
 * outside of it. No-op on mobile, where dropdowns are presented as bottom
 * sheets with their own dismiss handling.
 *
 * @param isMobile - Skip entirely when true (mobile uses bottom sheets instead)
 * @param onOutsideClick - Callback fired when a click lands outside `[data-dropdown]`
 *
 * @example
 * ```tsx
 * useDropdownOutsideClick(isMobile, () => setShowDropdown(false))
 *
 * return <div data-dropdown>...</div>
 * ```
 */
export function useDropdownOutsideClick(isMobile: boolean, onOutsideClick: () => void): void {
  useEffect(() => {
    if (isMobile) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest("[data-dropdown]")) {
        onOutsideClick()
      }
    }

    document.addEventListener("click", handleClickOutside)
    return () => document.removeEventListener("click", handleClickOutside)
  }, [isMobile, onOutsideClick])
}
