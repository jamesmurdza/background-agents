"use client"

import { useLayoutEffect, useState, type RefObject } from "react"

/**
 * Caps the height of an upward-opening dropdown (`absolute`, `bottom-full`)
 * to whatever space is actually available above it, so it scrolls instead
 * of being clipped by the viewport on short windows — and, unlike a fixed
 * `vh` cap, doesn't leave a dead gap for menus whose trigger sits lower on
 * screen than others.
 *
 * `bottom: 100%` pins the menu's bottom edge to the top of its
 * `position: relative` anchor, so that anchor's distance from the top of
 * the viewport *is* the available height. Pass a ref to the menu element
 * itself — its parent is assumed to be that anchor.
 *
 * @param open - Whether the menu is currently rendered/visible.
 * @param menuRef - Ref to the menu element (its parentElement is the anchor).
 * @param padding - Breathing room to leave above the menu, in px.
 */
export function useUpwardMenuMaxHeight(
  open: boolean,
  menuRef: RefObject<HTMLElement | null>,
  padding: number = 8
): number | undefined {
  const [maxHeight, setMaxHeight] = useState<number>()

  useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(undefined)
      return
    }

    const update = () => {
      const anchor = menuRef.current?.parentElement
      if (!anchor) return
      const top = anchor.getBoundingClientRect().top
      setMaxHeight(Math.max(top - padding, 100))
    }

    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [open, menuRef, padding])

  return maxHeight
}
