/**
 * ANSI escape code utilities
 */

/**
 * Strip ANSI escape codes, cursor controls, and terminal noise from CLI output
 */
export function stripAnsi(str: string): string {
  return (
    str
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "") // CSI sequences (colors, cursor)
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B\][^\x07]*\x07/g, "") // OSC sequences
      // eslint-disable-next-line no-control-regex
      .replace(/\x1B[@-Z\\-_]/g, "") // Two-byte escape sequences
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, "") // Control chars (keep \n)
      .replace(/\r/g, "") // Carriage returns
  )
}
