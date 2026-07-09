/**
 * Common utility functions shared across packages
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge Tailwind CSS classes with proper precedence handling
 * Combines clsx for conditional classes with tailwind-merge for deduplication
 *
 * @example
 * cn("px-2 py-1", "px-4") // => "py-1 px-4"
 * cn("text-red-500", isActive && "text-blue-500") // conditional
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extract the final segment (basename) from a "/"-separated path.
 * Falls back to the original string when there is no separator.
 *
 * @example
 * basename("src/lib/utils.ts") // => "utils.ts"
 * basename("README.md")        // => "README.md"
 */
export function basename(path: string): string {
  return path.split("/").pop() || path
}
