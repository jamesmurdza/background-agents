"use client"

import { useCallback, useLayoutEffect, useState } from "react"

/**
 * Coordinates two label groups (e.g. the composer's left and right trigger
 * clusters) as a priority pair, instead of each trigger deciding for itself:
 * the row first tries to show both groups' labels in full; if that doesn't
 * fit, the lower-priority group (`right`) collapses to icon-only first;
 * only if it *still* doesn't fit with `right` collapsed does the
 * higher-priority group (`left`) also collapse.
 *
 * Each group needs two hidden, always-rendered measurement clones — full
 * labels, and icon-only — attached via the matching `*NaturalRef`/
 * `*CollapsedRef`. Measuring both up front (rather than, say, collapsing
 * `right` and then checking whether `left` still fits) means re-expanding
 * is just as reliable as collapsing: nothing has to change the real visible
 * content first to find out whether a wider state would fit, which would
 * shift the available space and make the check lie about itself.
 */
export function useTwoTierCollapse() {
  // Plain refs can't tell us when the node they point at changes (e.g. the
  // measurement clones get unmounted/remounted as the composer flips between
  // mobile/desktop layouts) — a `useLayoutEffect` with an empty dependency
  // array would keep its ResizeObserver attached to the old, now-detached
  // nodes forever. Callback refs that land in state make every (re)mount
  // visible as a dependency change, so the effect below tears down and
  // re-observes whenever any of the five nodes is swapped out.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [leftNatural, setLeftNatural] = useState<HTMLDivElement | null>(null)
  const [leftCollapsed, setLeftCollapsed] = useState<HTMLDivElement | null>(null)
  const [rightNatural, setRightNatural] = useState<HTMLDivElement | null>(null)
  const [rightCollapsed, setRightCollapsed] = useState<HTMLDivElement | null>(null)
  const [showLeft, setShowLeft] = useState(true)
  const [showRight, setShowRight] = useState(true)

  const containerRef = useCallback((node: HTMLDivElement | null) => setContainer(node), [])
  const leftNaturalRef = useCallback((node: HTMLDivElement | null) => setLeftNatural(node), [])
  const leftCollapsedRef = useCallback((node: HTMLDivElement | null) => setLeftCollapsed(node), [])
  const rightNaturalRef = useCallback((node: HTMLDivElement | null) => setRightNatural(node), [])
  const rightCollapsedRef = useCallback((node: HTMLDivElement | null) => setRightCollapsed(node), [])

  useLayoutEffect(() => {
    if (!container || !leftNatural || !leftCollapsed || !rightNatural || !rightCollapsed) return

    const check = () => {
      // container.clientWidth includes the row's own padding, and doesn't
      // account for the gap between the left/right groups — both of which
      // eat into the space actually available to their content. Without
      // subtracting them, this check thinks there's more room than there
      // really is, so the real DOM can hit its own overflow/wrap point
      // slightly before React re-renders with the correct collapsed state.
      const style = getComputedStyle(container)
      const padding = parseFloat(style.paddingLeft || "0") + parseFloat(style.paddingRight || "0")
      const gap = parseFloat(style.columnGap || style.gap || "0")
      const available = container.clientWidth - padding - gap
      if (leftNatural.offsetWidth + rightNatural.offsetWidth <= available) {
        setShowLeft(true)
        setShowRight(true)
      } else if (leftNatural.offsetWidth + rightCollapsed.offsetWidth <= available) {
        setShowLeft(true)
        setShowRight(false)
      } else {
        setShowLeft(false)
        setShowRight(false)
      }
    }

    check()
    // Re-check on container resize, and whenever either group's natural or
    // collapsed footprint changes (new repo/branch/model name, items
    // appearing/disappearing, mobile/desktop icon-size changes, etc).
    const observer = new ResizeObserver(check)
    observer.observe(container)
    observer.observe(leftNatural)
    observer.observe(leftCollapsed)
    observer.observe(rightNatural)
    observer.observe(rightCollapsed)
    return () => observer.disconnect()
  }, [container, leftNatural, leftCollapsed, rightNatural, rightCollapsed])

  return { containerRef, leftNaturalRef, leftCollapsedRef, rightNaturalRef, rightCollapsedRef, showLeft, showRight }
}
