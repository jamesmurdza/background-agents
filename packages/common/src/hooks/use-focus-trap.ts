import { useEffect, useRef, useCallback } from "react"

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface UseFocusTrapOptions {
  /** Whether the focus trap is active */
  enabled?: boolean
  /** Element to return focus to when trap is disabled */
  returnFocusTo?: HTMLElement | null
  /** Whether to focus the first element when enabled */
  autoFocus?: boolean
  /** Callback when Escape is pressed */
  onEscape?: () => void
}

/**
 * Hook to trap focus within a container element.
 * Useful for modals, dropdowns, and other overlay components.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>({
  enabled = true,
  returnFocusTo,
  autoFocus = true,
  onEscape,
}: UseFocusTrapOptions = {}) {
  const containerRef = useRef<T>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Get all focusable elements within the container
  const getFocusableElements = useCallback((): HTMLElement[] => {
    if (!containerRef.current) return []
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter((el) => {
      // Filter out elements that are not visible
      return el.offsetParent !== null
    })
  }, [])

  // Handle tab key to trap focus
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || !containerRef.current) return

      if (e.key === "Escape" && onEscape) {
        e.preventDefault()
        onEscape()
        return
      }

      if (e.key !== "Tab") return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement as HTMLElement

      if (e.shiftKey) {
        // Shift + Tab: go to previous element
        if (activeElement === firstElement || !containerRef.current.contains(activeElement)) {
          e.preventDefault()
          lastElement.focus()
        }
      } else {
        // Tab: go to next element
        if (activeElement === lastElement || !containerRef.current.contains(activeElement)) {
          e.preventDefault()
          firstElement.focus()
        }
      }
    },
    [enabled, getFocusableElements, onEscape]
  )

  // Set up focus trap
  useEffect(() => {
    if (!enabled) return

    // Store the currently focused element
    previousActiveElement.current = document.activeElement as HTMLElement

    // Auto-focus first element
    if (autoFocus) {
      const focusableElements = getFocusableElements()
      if (focusableElements.length > 0) {
        // Use requestAnimationFrame to ensure DOM is ready
        requestAnimationFrame(() => {
          focusableElements[0].focus()
        })
      }
    }

    // Add event listener
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)

      // Return focus when trap is disabled
      const returnTo = returnFocusTo || previousActiveElement.current
      if (returnTo && typeof returnTo.focus === "function") {
        returnTo.focus()
      }
    }
  }, [enabled, autoFocus, getFocusableElements, handleKeyDown, returnFocusTo])

  return { containerRef, getFocusableElements }
}
