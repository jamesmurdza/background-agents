/**
 * Types for search and command palettes
 */

export interface SearchItem {
  id: string
  type: "repo" | "branch"
  label: string
  sublabel?: string
  repoOwner?: string
  repoName?: string
  branchName?: string
}

export interface RecentItem {
  id: string
  type: "repo" | "branch"
  repoOwner: string
  repoName: string
  branchName?: string
  timestamp: number
}

export interface PaletteState {
  searchOpen: boolean
  commandOpen: boolean
  openSearch: () => void
  closeSearch: () => void
  openCommand: () => void
  closeCommand: () => void
}
