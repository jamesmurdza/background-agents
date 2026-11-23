"use client"

import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Loading-spinner overlay + canvas element shared by `ImageThumbnail` and
 * `PdfThumbnail` — both render to an offscreen canvas and fade it in once the
 * first draw completes.
 */
export function CanvasThumbnailBody({
  canvasRef,
  loading,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  loading: boolean
}) {
  return (
    <>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
      <canvas ref={canvasRef} className={cn(loading && "opacity-0")} />
    </>
  )
}
