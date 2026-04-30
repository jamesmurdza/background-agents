import type { PreviewItem, PanelPlugin } from "./types"
import { FileViewerPlugin } from "./panels/file-viewer"
import { TerminalPlugin } from "./panels/terminal"
import { ServerPreviewPlugin } from "./panels/server-preview"
import { GitDiffPlugin } from "./panels/git-diff"

/**
 * All registered panel plugins.
 * Order matters - first matching plugin wins.
 */
const panelPlugins: PanelPlugin[] = [
  FileViewerPlugin,
  TerminalPlugin,
  ServerPreviewPlugin,
  GitDiffPlugin,
]

/**
 * Find the plugin that can handle the given preview item.
 */
export function getPanelPlugin(item: PreviewItem): PanelPlugin | null {
  return panelPlugins.find((plugin) => plugin.canHandle(item)) ?? null
}

/**
 * Get all registered panel plugins.
 */
export function getAllPanelPlugins(): PanelPlugin[] {
  return panelPlugins
}
