/**
 * Log-buffer arithmetic for the setup-script stream.
 *
 * The /setup SSE route always reads the job log from byte 0, so every
 * reconnect replays the whole log rather than resuming from a cursor. A
 * consumer that just appended would therefore show the log twice (or three
 * times) for exactly the case reconnects exist to cover: a script that
 * outlives the route's 5-minute ceiling while SETUP_TIMEOUT_SECONDS allows
 * 10. The first chunk after a reconnect replaces the buffer instead of
 * extending it; later chunks in the same connection append as usual.
 *
 * Replacing on the *first chunk* rather than at connect time keeps the log the
 * user was reading on screen while the reconnect is in flight, and keeps it
 * even if every retry fails.
 */
export function appendSetupLog(
  previous: string,
  chunk: string,
  isFirstChunkOfConnection: boolean
): string {
  return isFirstChunkOfConnection ? chunk : previous + chunk
}
