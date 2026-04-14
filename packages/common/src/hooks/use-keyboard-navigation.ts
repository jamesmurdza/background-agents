import { useCallback, useState, useRef, useEffect } from "react"

export interface UseKeyboardNavigationOptions {
  /** Number of items in the list */
  itemCount: number
  /** Callback when an item is selected (Enter/Space) */
  onSelect?: (index: number) => void
  /** Whether to wrap around at the ends */
  wrap?: boolean
  /** Orientation: 'vertical' uses Up/Down, 'horizontal' uses Left/Right */
  orientation?: "vertical" | "horizontal"
  /** Initial selected index */
  initialIndex?: number
  /** Whether the navigation is enabled */
  enabled?: boolean
}

export interface UseKeyboardNavigationReturn {
  /** Currently focused index */
  selectedIndex: number
  /** Set the selected index */
  setSelectedIndex: (index: number) => void
  /** Keyboard event handler to attach to the container or input */
  handleKeyDown: (e: React.KeyboardEvent) => void
  /** Reset to initial index */
  reset: () => void
}

/**
 * Hook for keyboard navigation in lists and menus.
 * Handles Arrow keys, Home/End, and Enter/Space for selection.
 */
export function useKeyboardNavigation({
  itemCount,
  onSelect,
  wrap = true,
  orientation = "vertical",
  initialIndex = 0,
  enabled = true,
}: UseKeyboardNavigationOptions): UseKeyboardNavigationReturn {
  const [selectedIndex, setSelectedIndex] = useState(initialIndex)

  // Reset when item count changes significantly
  useEffect(() => {
    if (selectedIndex >= itemCount) {
      setSelectedIndex(Math.max(0, itemCount - 1))
    }
  }, [itemCount, selectedIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!enabled || itemCount === 0) return

      const prevKey = orientation === "vertical" ? "ArrowUp" : "ArrowLeft"
      const nextKey = orientation === "vertical" ? "ArrowDown" : "ArrowRight"

      switch (e.key) {
        case nextKey:
          e.preventDefault()
          setSelectedIndex((prev) => {
            if (prev >= itemCount - 1) {
              return wrap ? 0 : prev
            }
            return prev + 1
          })
          break

        case prevKey:
          e.preventDefault()
          setSelectedIndex((prev) => {
            if (prev <= 0) {
              return wrap ? itemCount - 1 : prev
            }
            return prev - 1
          })
          break

        case "Home":
          e.preventDefault()
          setSelectedIndex(0)
          break

        case "End":
          e.preventDefault()
          setSelectedIndex(itemCount - 1)
          break

        case "Enter":
        case " ":
          if (onSelect && e.key === "Enter") {
            e.preventDefault()
            onSelect(selectedIndex)
          }
          // Space is handled separately to allow typing in inputs
          if (e.key === " " && e.target === e.currentTarget) {
            e.preventDefault()
            onSelect?.(selectedIndex)
          }
          break
      }
    },
    [enabled, itemCount, orientation, wrap, onSelect, selectedIndex]
  )

  const reset = useCallback(() => {
    setSelectedIndex(initialIndex)
  }, [initialIndex])

  return {
    selectedIndex,
    setSelectedIndex,
    handleKeyDown,
    reset,
  }
}
