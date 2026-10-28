"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Shared mousedown → window mousemove/mouseup wiring for drag-to-resize
 * panels (the sidebar and the preview pane both have one): swaps in a
 * `col-resize` cursor and disables text selection for the duration of the
 * drag, and reports whether a drag is currently in progress.
 *
 * `onMove` is read via a ref on every mousemove while dragging, so callers
 * don't need to memoize it with a stable dependency array — passing a fresh
 * closure on every render is fine.
 */
export function useDragResize(onMove: (e: MouseEvent) => void): {
  startDrag: (e: React.MouseEvent) => void
  isDragging: boolean
} {
  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef(false)
  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    setIsDragging(true)
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (draggingRef.current) onMoveRef.current(e)
    }
    const stop = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setIsDragging(false)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", stop)
    return () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", stop)
    }
  }, [])

  return { startDrag, isDragging }
}
