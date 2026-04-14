import { useCallback, useState, useRef, useEffect } from "react"

export interface UseRovingTabIndexOptions {
  /** Number of items in the group */
  itemCount: number
  /** Orientation: 'horizontal' uses Left/Right, 'vertical' uses Up/Down */
  orientation?: "horizontal" | "vertical"
  /** Whether to wrap around at the ends */
  wrap?: boolean
  /** Initial focused index */
  initialIndex?: number
  /** Callback when focus changes */
  onFocusChange?: (index: number) => void
  /** Whether navigation is enabled */
  enabled?: boolean
}

export interface UseRovingTabIndexReturn {
  /** Currently focused index (the one that should have tabIndex=0) */
  focusedIndex: number
  /** Set the focused index */
  setFocusedIndex: (index: number) => void
  /** Get tabIndex for an item at the given index */
  getTabIndex: (index: number) => 0 | -1
  /** Keyboard event handler for the container */
  handleKeyDown: (e: React.KeyboardEvent) => void
  /** Ref map for storing item refs */
  itemRefs: React.MutableRefObject<Map<number, HTMLElement | null>>
}

/**
 * Hook for implementing roving tabindex pattern.
 * Only one element in the group is tabbable (tabIndex=0),
 * arrow keys move focus between items.
 *
 * Use this for tab bars, toolbars, and other widget groups.
 */
export function useRovingTabIndex({
  itemCount,
  orientation = "horizontal",
  wrap = true,
  initialIndex = 0,
  onFocusChange,
  enabled = true,
}: UseRovingTabIndexOptions): UseRovingTabIndexReturn {
  const [focusedIndex, setFocusedIndexState] = useState(initialIndex)
  const itemRefs = useRef<Map<number, HTMLElement | null>>(new Map())

  // Update focused index and optionally focus the element
  const setFocusedIndex = useCallback(
    (index: number, shouldFocus = false) => {
      setFocusedIndexState(index)
      onFocusChange?.(index)

      if (shouldFocus) {
        const element = itemRefs.current.get(index)
        if (element) {
          element.focus()
        }
      }
    },
    [onFocusChange]
  )

  // Reset when item count changes
  useEffect(() => {
    if (focusedIndex >= itemCount) {
      setFocusedIndexState(Math.max(0, itemCount - 1))
    }
  }, [itemCount, focusedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled || itemCount === 0) return

      const prevKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp"
      const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown"

      let newIndex = focusedIndex

      switch (e.key) {
        case nextKey:
          e.preventDefault()
          if (focusedIndex >= itemCount - 1) {
            newIndex = wrap ? 0 : focusedIndex
          } else {
            newIndex = focusedIndex + 1
          }
          break

        case prevKey:
          e.preventDefault()
          if (focusedIndex <= 0) {
            newIndex = wrap ? itemCount - 1 : focusedIndex
          } else {
            newIndex = focusedIndex - 1
          }
          break

        case "Home":
          e.preventDefault()
          newIndex = 0
          break

        case "End":
          e.preventDefault()
          newIndex = itemCount - 1
          break

        default:
          return
      }

      if (newIndex !== focusedIndex) {
        setFocusedIndex(newIndex, true)
      }
    },
    [enabled, itemCount, orientation, wrap, focusedIndex, setFocusedIndex]
  )

  const getTabIndex = useCallback(
    (index: number): 0 | -1 => {
      return index === focusedIndex ? 0 : -1
    },
    [focusedIndex]
  )

  return {
    focusedIndex,
    setFocusedIndex,
    getTabIndex,
    handleKeyDown,
    itemRefs,
  }
}
