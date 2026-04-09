import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a random branch name from word list
 */
const BRANCH_NAME_WORDS = [
  "swift", "lunar", "amber", "coral", "ember", "frost", "bloom", "spark",
  "drift", "pulse", "cedar", "maple", "river", "stone", "cloud", "flame",
  "steel", "light", "storm", "wave", "tiger", "eagle", "brave", "vivid",
  "noble", "rapid", "quiet", "sharp", "fresh", "grand",
] as const

export function generateBranchName(): string {
  const word1 = BRANCH_NAME_WORDS[Math.floor(Math.random() * BRANCH_NAME_WORDS.length)]
  const word2 = BRANCH_NAME_WORDS[Math.floor(Math.random() * BRANCH_NAME_WORDS.length)]
  const suffix = Math.random().toString(36).substring(2, 6)
  return `${word1}-${word2}-${suffix}`
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}
