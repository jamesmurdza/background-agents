/**
 * Shell utilities shared across git command construction.
 */

/**
 * Escape a shell argument by wrapping it in single quotes, so that any
 * embedded metacharacters are treated literally and cannot be used for
 * command injection. Single quotes inside the argument are handled with the
 * standard `'\''` sequence.
 *
 * @example
 * shellEscape("main")            // => "'main'"
 * shellEscape("foo'; rm -rf /")  // => "'foo'\\''; rm -rf /'"
 */
export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}
