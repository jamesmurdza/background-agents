import type { LucideIcon } from "lucide-react"

/**
 * Data passed when opening a preview panel.
 * Each item type is handled by a specific plugin.
 */
export type PreviewItem =
  | { type: "file"; filePath: string; filename: string }
  | { type: "terminal"; id: string }
  | { type: "server"; port: number; url: string }
  | { type: "git-diff"; baseBranch: string }

/**
 * Props passed to every panel plugin component.
 */
export interface PanelProps {
  item: PreviewItem
  sandboxId: string | null
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
