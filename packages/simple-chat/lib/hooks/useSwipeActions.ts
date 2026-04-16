"use client"

import { useState, useCallback, useRef, useEffect, RefCallback } from "react"

interface UseSwipeActionsOptions {
  /** Minimum swipe distance to reveal actions (default: 60px) */
  threshold?: number
  /** Maximum swipe distance (default: 140px for two actions) */
  maxSwipe?: number
  /** Whether swipe actions are enabled (default: true) */
  enabled?: boolean
}

interface UseSwipeActionsResult {
  /** Current swipe offset (negative = left, positive = right) */
  swipeOffset: number
  /** Whether currently swiping */
  isSwiping: boolean
  /** Whether actions are revealed (swipe past threshold) */
  isRevealed: boolean
  /** Reset swipe state */
  reset: () => void
  /** Ref callback to attach to the swipeable element */
  swipeRef: RefCallback<HTMLElement>
}

export function useSwipeActions({
  threshold = 60,
  maxSwipe = 140,
  enabled = true,
}: UseSwipeActionsOptions = {}): UseSwipeActionsResult {
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)

  const elementRef = useRef<HTMLElement | null>(null)
  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)
  const currentOffset = useRef(0)

  // Use refs for state that needs to be accessed in event handlers
  const enabledRef = useRef(enabled)
  const isRevealedRef = useRef(isRevealed)
  const isSwipingRef = useRef(isSwiping)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    isRevealedRef.current = isRevealed
  }, [isRevealed])

  useEffect(() => {
    isSwipingRef.current = isSwiping
  }, [isSwiping])

  const reset = useCallback(() => {
    setSwipeOffset(0)
    setIsRevealed(false)
    setIsSwiping(false)
    currentOffset.current = 0
  }, [])

  const resetRef = useRef(reset)
  useEffect(() => {
    resetRef.current = reset
  }, [reset])

  // Attach non-passive touch event listeners
  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const handleTouchStart = (e: TouchEvent) => {
      if (!enabledRef.current) return

      // If already revealed, reset first
      if (isRevealedRef.current) {
        resetRef.current()
        return
      }

      setIsSwiping(true)
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      isHorizontalSwipe.current = null
      currentOffset.current = 0
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isSwipingRef.current || !enabledRef.current) return

      const currentX = e.touches[0].clientX
      const currentY = e.touches[0].clientY
      const diffX = currentX - startX.current
      const diffY = currentY - startY.current

      // Determine if horizontal or vertical swipe (first 10px of movement)
      if (isHorizontalSwipe.current === null && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
        isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY)
      }

      // Only handle horizontal swipes
      if (isHorizontalSwipe.current === false) {
        setIsSwiping(false)
        return
      }

      if (isHorizontalSwipe.current === true) {
        // Prevent vertical scrolling during horizontal swipe
        e.preventDefault()

        // Apply resistance when swiping past max
        let offset = diffX
        if (Math.abs(offset) > maxSwipe) {
          const overflow = Math.abs(offset) - maxSwipe
          const resistance = 0.3
          offset = offset > 0
            ? maxSwipe + overflow * resistance
            : -(maxSwipe + overflow * resistance)
        }

        // Only allow right swipe (positive direction to reveal left-side actions)
        // This avoids conflict with drawer swipe-to-close (left swipe)
        if (offset > 0) {
          currentOffset.current = offset
          setSwipeOffset(offset)
        }
      }
    }

    const handleTouchEnd = () => {
      if (!isSwipingRef.current) return

      setIsSwiping(false)
      isHorizontalSwipe.current = null

      // If swiped past threshold, lock in the revealed state
      if (currentOffset.current >= threshold) {
        setIsRevealed(true)
        setSwipeOffset(maxSwipe)
      } else {
        // Snap back to closed
        resetRef.current()
      }
    }

    // Use non-passive listeners to allow preventDefault
    element.addEventListener("touchstart", handleTouchStart, { passive: true })
    element.addEventListener("touchmove", handleTouchMove, { passive: false })
    element.addEventListener("touchend", handleTouchEnd, { passive: true })

    return () => {
      element.removeEventListener("touchstart", handleTouchStart)
      element.removeEventListener("touchmove", handleTouchMove)
      element.removeEventListener("touchend", handleTouchEnd)
    }
  }, [maxSwipe, threshold])

  const swipeRef: RefCallback<HTMLElement> = useCallback((node) => {
    elementRef.current = node
  }, [])

  return {
    swipeOffset,
    isSwiping,
    isRevealed,
    reset,
    swipeRef,
  }
}
