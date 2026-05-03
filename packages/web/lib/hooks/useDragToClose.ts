"use client"

import { useState, useCallback, useRef, useEffect } from "react"

interface UseDragToCloseOptions {
  /** Callback when drag threshold is exceeded */
  onClose: () => void
  /** Whether drag-to-close is enabled */
  enabled?: boolean
  /** Threshold as percentage of element height (0-1) to trigger close. Default: 0.3 */
  threshold?: number
}

interface UseDragToCloseResult {
  /** Spread these on any element that should be draggable */
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
  /** Current drag offset in pixels */
  dragY: number
  /** Whether currently dragging */
  isDragging: boolean
  /** Ref to attach to the element that moves (for height calculation) */
  dragRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Hook for drag-to-close functionality on mobile drawers/sheets.
 *
 * Usage:
 * ```tsx
 * const { handlers, dragY, isDragging, dragRef } = useDragToClose({ onClose })
 *
 * <div ref={dragRef} style={{ transform: `translateY(${dragY}px)` }}>
 *   <div {...handlers}>Drag handle area</div>
 *   <div>Content (not draggable)</div>
 * </div>
 * ```
 */
export function useDragToClose({
  onClose,
  enabled = true,
  threshold = 0.3,
}: UseDragToCloseOptions): UseDragToCloseResult {
  const dragRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [startY, setStartY] = useState(0)
  const [elementHeight, setElementHeight] = useState(0)

  // Measure element height when ref changes
  useEffect(() => {
    if (dragRef.current) {
      setElementHeight(dragRef.current.offsetHeight)
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return

    // Update height measurement
    if (dragRef.current) {
      setElementHeight(dragRef.current.offsetHeight)
    }

    setIsDragging(true)
    setStartY(e.touches[0].clientY)
    setDragY(0)
  }, [enabled])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || !enabled) return

    const currentY = e.touches[0].clientY
    const diff = currentY - startY

    // Only allow dragging down (positive direction)
    if (diff > 0) {
      setDragY(diff)
    }
  }, [isDragging, startY, enabled])

  const handleTouchEnd = useCallback(() => {
    if (!isDragging || !enabled) return

    setIsDragging(false)

    // If dragged more than threshold of element height, close it
    if (dragY > elementHeight * threshold) {
      onClose()
    }

    setDragY(0)
  }, [isDragging, dragY, elementHeight, threshold, onClose, enabled])

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    dragY,
    isDragging,
    dragRef,
  }
}
