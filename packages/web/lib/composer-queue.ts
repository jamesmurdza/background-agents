/** The persisted queue carries text, agent and model, but not files or Plan mode. */
export function queuedSendNotice({
  isRunning, isPaused, hasFiles, planMode, hasText,
}: { isRunning: boolean; isPaused: boolean; hasFiles: boolean; planMode: boolean; hasText: boolean }): string | undefined {
  if (!isRunning && !isPaused) return undefined
  if (hasFiles) return "Attachments can't be queued. Keep this draft until the queue is clear, or remove the attachments."
  if (planMode && hasText) return "Plan mode can't be queued. Wait until the queue is clear, or turn off Plan mode to queue this text."
  return undefined
}
