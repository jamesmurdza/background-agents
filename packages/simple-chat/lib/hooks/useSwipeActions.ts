"use client"

import { useState, useCallback, useRef } from "react"

interface UseSwipeActionsOptions {
  /** Minimum swipe distance to reveal actions (default: 60px) */
  threshold?: number
  /** Maximum swipe distance (default: 140px for two actions) */
  maxSwipe?: number
  /** Callback when swiped past threshold */
  onSwipeLeft?: () => void
  /** Callback when swiped right past threshold */
  onSwipeRight?: () => void
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
  /** Props to spread on the swipeable element */
  swipeProps: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
}

export function useSwipeActions({
  threshold = 60,
  maxSwipe = 140,
  onSwipeLeft,
  onSwipeRight,
  enabled = true,
}: UseSwipeActionsOptions = {}): UseSwipeActionsResult {
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [isSwiping, setIsSwiping] = useState(false)
  const [isRevealed, setIsRevealed] = useState(false)

  const startX = useRef(0)
  const startY = useRef(0)
  const isHorizontalSwipe = useRef<boolean | null>(null)

  const reset = useCallback(() => {
    setSwipeOffset(0)
    setIsRevealed(false)
    setIsSwiping(false)
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return

    // If already revealed, reset first
    if (isRevealed) {
      reset()
      return
    }

    setIsSwiping(true)
    startX.current = e.touches[0].clientX
    startY.current = e.touches[0].clientY
    isHorizontalSwipe.current = null
  }, [enabled, isRevealed, reset])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping || !enabled) return

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

      // Only allow left swipe (negative direction to reveal right-side actions)
      if (offset < 0) {
        setSwipeOffset(offset)
      }
    }
  }, [isSwiping, enabled, maxSwipe])

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping) return

    setIsSwiping(false)
    isHorizontalSwipe.current = null

    // If swiped past threshold, lock in the revealed state
    if (Math.abs(swipeOffset) >= threshold) {
      setIsRevealed(true)
      // Snap to max swipe position
      setSwipeOffset(swipeOffset < 0 ? -maxSwipe : maxSwipe)
    } else {
      // Snap back to closed
      reset()
    }
  }, [isSwiping, swipeOffset, threshold, maxSwipe, reset])

  return {
    swipeOffset,
    isSwiping,
    isRevealed,
    reset,
    swipeProps: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  }
}
