/**
 * Shell escaping utilities for safe command construction.
 */

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
