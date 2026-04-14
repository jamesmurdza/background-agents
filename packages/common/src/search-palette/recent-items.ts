/**
 * Recent items storage helpers for search palette
 */

import type { RecentItem } from "./types"

const STORAGE_KEY = "upstream-recent-items"
const MAX_RECENT_ITEMS = 10

export function getRecentItems(): RecentItem[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function addRecentItem(item: Omit<RecentItem, "timestamp">): void {
  if (typeof window === "undefined") return
  try {
    const items = getRecentItems()
    // Remove existing entry if present
    const filtered = items.filter((i) => i.id !== item.id)
    // Add to front with timestamp
    const updated = [{ ...item, timestamp: Date.now() }, ...filtered].slice(
      0,
      MAX_RECENT_ITEMS
    )
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  } catch {
    // Ignore storage errors
  }
}

export function clearRecentItems(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore storage errors
  }
}
