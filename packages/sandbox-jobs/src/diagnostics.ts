/** Make sandbox command output safe to show as a one-off error message: drop
 * terminal escape and control codes, and bound its length. The text itself is
 * shown as is. Env values never reach it: they travel in the request's env
 * field, not the command, and the job's own output goes to its log file. */
export function sandboxDiagnostic(output: string): string {
  return output
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 2_000)
}
