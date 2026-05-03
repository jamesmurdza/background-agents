"use client"

import { Globe } from "lucide-react"
import type { PanelPlugin, PanelProps, PreviewItem } from "../types"

function ServerPreviewComponent({ item, scale = 1 }: PanelProps) {
  const url = item.type === "server" ? item.url : ""

  // When scale < 1, we expand the iframe and use CSS transform to shrink it
  const iframeStyle: React.CSSProperties = scale < 1
    ? {
        width: `${100 / scale}%`,
        height: `${100 / scale}%`,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }
    : {}

  return (
    <div className="h-full w-full overflow-hidden">
      <iframe
        src={url}
        className="border-0 bg-white"
        style={{
          width: "100%",
          height: "100%",
          ...iframeStyle,
        }}
        title="Live preview"
      />
    </div>
  )
}

export const ServerPreviewPlugin: PanelPlugin = {
  id: "server-preview",

  canHandle: (item: PreviewItem) => item.type === "server",

  getLabel: (item: PreviewItem) => {
    if (item.type === "server") {
      return `:${item.port}`
    }
    return "Preview"
  },

  getIcon: () => Globe,

  Component: ServerPreviewComponent,
}
