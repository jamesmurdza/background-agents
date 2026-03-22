/**
 * Utility for parsing Server-Sent Events (SSE) streams
 */

export interface SSEEvent {
  type: string
  [key: string]: unknown
}

/**
 * Parse an SSE stream and call the handler for each event.
 * Returns when the stream is done.
 */
export async function parseSSEStream(
  response: Response,
  onEvent: (event: SSEEvent) => void
): Promise<void> {
  if (!response.body) {
    throw new Error("Empty server response")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n\n")
    buffer = parts.pop()!

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data: ")) continue
        try {
          const data = JSON.parse(line.slice(6)) as SSEEvent
          onEvent(data)
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

/**
 * Simpler SSE parser that collects events of specific types.
 * Useful when you just need to wait for a "done" or "error" event.
 */
export async function waitForSSEResult<T extends SSEEvent>(
  response: Response,
  doneType = "done",
  errorType = "error"
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  let result: T | null = null
  let error: string | null = null

  await parseSSEStream(response, (event) => {
    if (event.type === doneType) {
      result = event as T
    } else if (event.type === errorType) {
      error = (event.message as string) || (event.error as string) || "Unknown error"
    }
  })

  if (error) {
    return { success: false, error }
  }
  if (result) {
    return { success: true, data: result }
  }
  return { success: false, error: "Stream ended without result" }
}
