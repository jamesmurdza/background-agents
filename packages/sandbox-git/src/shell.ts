/**
 * Shell utilities for building sandbox git commands.
 */

/**
 * Escape a shell argument to prevent injection.
 */
export function esc(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}
