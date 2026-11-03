import type { LucideIcon } from "lucide-react"

/**
 * Data passed when opening a preview panel.
 * Each item type is handled by a specific plugin.
 */
export type PreviewItem =
  | { type: "file"; filePath: string; filename: string }
  | { type: "terminal"; id: string }
  | { type: "server"; port: number; url: string }
  | { type: "directory"; dirPath: string }
  | { type: "changes" }

/**
 * Props passed to every panel plugin component.
 */
export interface PanelProps {
  item: PreviewItem
  sandboxId: string | null
  /** The chat this preview belongs to, so a panel can trigger sandbox recovery. */
  chatId?: string | null
  /**
   * Called after a panel recreates a dead sandbox (e.g. the server-preview
   * panel's "expired" recovery), with the fresh sandboxId. The caller should
   * persist it onto the chat so sandboxId prop updates and future requests
   * target the new sandbox instead of the deleted one.
   *
   * `serverUrl` is passed when the recreated sandbox has a new preview URL
   * for the panel's port (preview URLs are sandbox-scoped, so a recreation
   * always changes it) — the caller should also patch the matching `server`
   * PreviewItem's `url` so the iframe and "open in new window" don't keep
   * pointing at the deleted sandbox.
   */
  onSandboxRecreated?: (sandboxId: string, serverUrl?: { port: number; url: string }) => void
  /**
   * Called by a panel whenever its own ability to recover from a non-"ready"
   * state changes — `recover` while recovery is possible (a function that
   * performs it and resolves to the item's URL once ready, or null on
   * failure), `null` otherwise (e.g. "ready", or a state nothing can fix like
   * "error"). Lets a parent that renders UI outside the panel (PreviewView's
   * "open in new window" button) run the same recovery flow — boot a
   * "stopped" sandbox, recreate an "expired" one — before acting, without
   * re-probing the sandbox itself or duplicating that logic.
   */
  onRecoverableChange?: (recover: (() => Promise<string | null>) | null) => void
  /** Optional scale factor for preview (e.g., 0.5, 0.75, 1) */
  scale?: number
  /** All messages in the current chat, for plugins that need live content */
  messages?: import("@/lib/types").Message[]
  /**
   * Bumped on every explicit refresh (top-bar button or an in-panel retry).
   * Included in the panel's React key, so a bump remounts and reloads it.
   */
  refreshNonce: number
  /**
   * True when the current mount was caused by an explicit user refresh, so the
   * panel may boot a stopped sandbox. Resets when switching preview items, so
   * merely opening a stopped sandbox's file never auto-boots it.
   */
  explicitStart: boolean
  /**
   * The single refresh path. A panel's in-panel retry (e.g. PanelState's
   * button) calls this so it behaves exactly like the top-bar refresh.
   */
  onRefresh: () => void
  /**
   * Open another preview item — adds it to the tab list (or switches to it if
   * already open). Used by panels that let the user drill into something else
   * from within themselves, e.g. the file-browser opening a file it lists.
   */
  onOpenItem?: (item: PreviewItem) => void
  /** Server preview only: "Select element" state for PreviewView's title bar button, or null. */
  onSelectModeChange?: (mode: SelectMode | null) => void
}

export interface SelectMode {
  active: boolean
  toggle: () => void
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
