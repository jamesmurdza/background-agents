/**
 * Utilities for Simple Chat
 * Re-exports from @background-agents/common
 */

import type { Ref } from "react"

export { cn, generateBranchName } from "@background-agents/common"

/**
 * Shared Radix `Dialog.Overlay` / bottom-sheet backdrop styling. Combine with
 * `transition-opacity duration-300` + an `opacity-0`/`opacity-100` toggle for
 * dialogs that animate the overlay in; a handful of lightweight dialogs skip
 * the transition and use this on its own.
 */
export const MODAL_OVERLAY_CLASS = "fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px]"

/**
 * Merges multiple refs (callback or object) onto one DOM node. Needed
 * whenever a component both forwards an external ref (e.g. so Radix's
 * `asChild` can position a popover off it) and also needs its own ref on
 * that same node (e.g. for a measurement hook).
 */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === "function") ref(node)
      else (ref as { current: T | null }).current = node
    }
  }
}
