import type { LucideIcon } from "lucide-react"

/**
 * Data passed when opening a preview panel.
 * Each item type is handled by a specific plugin.
 */
export type PreviewItem =
  | { type: "file"; filePath: string; filename: string }
  | { type: "terminal"; id: string }
  | { type: "server"; port: number; url: string }

/**
 * Props passed to every panel plugin component.
 */
export interface PanelProps {
  item: PreviewItem
  sandboxId: string | null
  /** Optional scale factor for preview (e.g., 0.5, 0.75, 1) */
  scale?: number
  /**
   * Set when the user explicitly refreshed via the top-bar refresh button.
   * Lets a panel boot a stopped sandbox (otherwise passive reads stay passive).
   */
  autoStart?: boolean
  /** All messages in the current chat, for plugins that need live content */
  messages?: import("@/lib/types").Message[]
}

/**
 * A panel plugin definition.
 */
export interface PanelPlugin {
  /** Unique identifier */
  id: string

  /** Check if this plugin can handle the given item */
  canHandle: (item: PreviewItem) => boolean

  /** Display label for the titlebar */
  getLabel: (item: PreviewItem) => string

  /** Icon for the titlebar */
  getIcon: () => LucideIcon

  /** The React component to render */
  Component: React.ComponentType<PanelProps>
}
