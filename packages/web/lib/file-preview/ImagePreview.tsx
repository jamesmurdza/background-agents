"use client"

import { useState, useRef, useEffect } from "react"
import { cn } from "@/lib/utils"
import { CanvasThumbnailBody } from "./CanvasThumbnailBody"

interface ImageThumbnailProps {
  /** The image File object to render */
  file: File
  /** Thumbnail size in pixels (default: 108) */
  size?: number
  /** Additional className */
  className?: string
}

/**
 * High-DPI image thumbnail that center-crops to a square.
 * Uses canvas for crisp rendering on retina displays.
 */
export function ImageThumbnail({ file, size = 108, className }: ImageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const context = canvas.getContext('2d')
    if (!context) return

    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      const dpr = window.devicePixelRatio || 1

      // Set canvas size accounting for device pixel ratio
      canvas.width = size * dpr
      canvas.height = size * dpr
      canvas.style.width = `${size}px`
      canvas.style.height = `${size}px`

      // Calculate crop to cover the thumbnail (center crop)
      const imgAspect = img.width / img.height
      const thumbAspect = 1 // Square thumbnail

      let srcX = 0, srcY = 0, srcW = img.width, srcH = img.height

      if (imgAspect > thumbAspect) {
        // Image is wider - crop sides
        srcW = img.height
        srcX = (img.width - srcW) / 2
      } else {
        // Image is taller - crop top/bottom
        srcH = img.width
        srcY = (img.height - srcH) / 2
      }

      // Enable image smoothing for better quality
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      // Draw the cropped and scaled image
      context.drawImage(
        img,
        srcX, srcY, srcW, srcH, // Source rectangle
        0, 0, canvas.width, canvas.height // Destination rectangle
      )

      URL.revokeObjectURL(url)
      setLoading(false)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      setLoading(false)
    }

    img.src = url

    return () => {
      URL.revokeObjectURL(url)
    }
  }, [file, size])

  return (
    <div className={cn("w-full h-full flex items-center justify-center overflow-hidden", className)}>
      <CanvasThumbnailBody canvasRef={canvasRef} loading={loading} />
    </div>
  )
}

interface ImageFullPreviewProps {
  /** Object URL or data URL for the image */
  src: string
  /** Alt text for accessibility */
  alt: string
  /** Additional className */
  className?: string
  /** Maximum height (CSS value, e.g., "70vh") */
  maxHeight?: string
}

/**
 * Full-size image preview, centered and constrained to container.
 */
export function ImageFullPreview({ src, alt, className, maxHeight = "70vh" }: ImageFullPreviewProps) {
  return (
    <div className={cn("flex items-center justify-center p-6 bg-muted/10 min-h-[200px]", className)}>
      <img
        src={src}
        alt={alt}
        className="max-w-full object-contain rounded"
        style={{ maxHeight }}
      />
    </div>
  )
}
