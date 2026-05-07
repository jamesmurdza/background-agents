"use client"

import { useEffect, RefObject } from "react"

/**
 * Hook to detect clicks outside of a referenced element.
 * Useful for closing dropdowns, menus, and modals.
 *
 * @param ref - React ref to the element to monitor
 * @param onClickOutside - Callback when click outside is detected
 * @param enabled - Whether the hook is active (default: true)
 *
 * @example
 * ```tsx
 * const dropdownRef = useRef<HTMLDivElement>(null)
 * const [open, setOpen] = useState(false)
 *
 * useClickOutside(dropdownRef, () => setOpen(false), open)
 *
 * return <div ref={dropdownRef}>...</div>
 * ```
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClickOutside: () => void,
  enabled: boolean = true
): void {
  useEffect(() => {
    if (!enabled) return

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [ref, onClickOutside, enabled])
}
