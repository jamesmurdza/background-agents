/**
 * Types for search and command palettes
 */

export interface RecentItem {
  id: string
  type: "repo" | "branch"
  repoOwner: string
  repoName: string
  branchName?: string
  timestamp: number
}
