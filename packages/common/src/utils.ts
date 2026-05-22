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
 * Escape a string for use inside single-quoted shell strings.
 *
 * This handles the edge case where the string contains single quotes
 * by ending the current single-quoted string, adding an escaped single quote,
 * and starting a new single-quoted string.
 *
 * Example: "it's" becomes "it'\''s" which shell interprets as: 'it' + \' + 's'
 *
 * @param str - The string to escape
 * @returns The escaped string (without surrounding quotes)
 */
export function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''")
}

/**
 * Quote a string for bash by wrapping in single quotes and escaping.
 *
 * Use this when you need the full quoted string, not just the escaped content.
 *
 * @param str - The string to quote
 * @returns The fully quoted string (with surrounding single quotes)
 */
export function quote(str: string): string {
  return `'${escapeShell(str)}'`
}
