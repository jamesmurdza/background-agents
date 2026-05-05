/**
 * Shared types for search palette components
 */

/**
 * Minimal chat interface for search palette components
 * Contains only the fields needed for search and display
 */
export interface PaletteChat {
  id: string
  displayName: string | null
  repo: string
}
