"use client"

import { useState, useRef, useEffect } from "react"
import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { CanvasThumbnailBody } from "./CanvasThumbnailBody"

interface PdfThumbnailProps {
  /** The PDF File object to render */
  file: File
  /** Thumbnail size in pixels (default: 108) */
  size?: number
  /** Additional className */
  className?: string
}

/**
 * High-DPI PDF thumbnail that renders the first page.
 * Uses pdfjs-dist for rendering and canvas for crisp display.
 */
export function PdfThumbnail({ file, size = 108, className }: PdfThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false

    const renderPdf = async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist')

        // Set up worker - use unpkg CDN
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

        const arrayBuffer = await file.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

        if (cancelled) return

        const page = await pdf.getPage(1)
        const canvas = canvasRef.current
        if (!canvas || cancelled) return

        const context = canvas.getContext('2d')
        if (!context) return

        // Account for device pixel ratio for crisp rendering
        const dpr = window.devicePixelRatio || 1

        const viewport = page.getViewport({ scale: 1 })

        // Scale so the page width equals thumbnail size * dpr (for crisp rendering)
        const scale = (size * dpr) / viewport.width
        const scaledViewport = page.getViewport({ scale })

        // Set canvas to thumbnail size * dpr (internal resolution)
        canvas.width = size * dpr
        canvas.height = size * dpr

        // Scale down via CSS to display at thumbnail size
        canvas.style.width = `${size}px`
        canvas.style.height = `${size}px`

        // Fill with white background
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)

        // Render the page directly - it will extend beyond canvas height but be clipped
        await page.render({
          canvasContext: context,
          viewport: scaledViewport
        }).promise

        if (!cancelled) {
          setLoading(false)
        }
      } catch (err) {
        console.error('PDF thumbnail render error:', err)
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    }

    renderPdf()

    return () => {
      cancelled = true
    }
  }, [file, size])

  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center text-muted-foreground w-full h-full", className)}>
        <FileText className="h-5 w-5" />
        <span className="text-[10px] mt-0.5 font-medium">PDF</span>
      </div>
    )
  }

  return (
    <div className={cn("w-full h-full flex items-center justify-center bg-white overflow-hidden", className)}>
      <CanvasThumbnailBody canvasRef={canvasRef} loading={loading} />
    </div>
  )
}

interface PdfFullPreviewProps {
  /** Object URL for the PDF */
  src: string
  /** Title for the iframe */
  title: string
  /** Additional className */
  className?: string
  /** Height (CSS value, e.g., "70vh") */
  height?: string
}

/**
 * Full PDF viewer using an iframe.
 */
export function PdfFullPreview({ src, title, className, height = "70vh" }: PdfFullPreviewProps) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <iframe
        src={src}
        title={title}
        className="w-full h-full border-0"
      />
    </div>
  )
}
