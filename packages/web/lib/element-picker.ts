/**
 * "Select element" in the Live Preview. The panel can't look into the
 * cross-origin preview, so a proxy in the sandbox adds a picker script to the
 * page (element-picker-sandbox.ts), which talks to the panel with postMessage:
 *   picker → panel  { type: PREFIX + "ready" }               on every page load
 *   panel → picker  { type: PREFIX + "toggle", on }
 *   picker → panel  { type: PREFIX + "selected", element }   on click
 */

export const PICKER_MESSAGE_PREFIX = "backgrounder-element-picker:"

/** What the picker reports about the clicked element. */
export interface SelectedElement {
  path: string
  /** Opening tag and text, trimmed, e.g. `<button class="btn">Pay now</button>`. */
  html: string
  selector: string
  /** Where the element is in the page's viewport, for placing the comment box. */
  rect: { top: number; left: number; bottom: number }
}

/** The text added to the chat input for one comment. */
export function formatElementComment(element: SelectedElement, comment: string): string {
  return `On ${element.path}, ${element.html} (${element.selector}):\n${comment.trim()}`
}

export const COMMENT_BOX_WIDTH = 288
const BOX_HEIGHT = 140
const GAP = 8

/** Under the element, or above it if there's no room, kept inside the panel. `scale` is the preview's zoom. */
export function commentBoxPosition(
  rect: SelectedElement["rect"],
  scale: number,
  panel: { width: number; height: number }
): { top: number; left: number } {
  const below = rect.bottom * scale + GAP
  const top = below + BOX_HEIGHT <= panel.height ? below : rect.top * scale - BOX_HEIGHT - GAP
  const left = Math.min(rect.left * scale, panel.width - COMMENT_BOX_WIDTH - GAP)
  return { top: Math.max(GAP, top), left: Math.max(GAP, left) }
}
