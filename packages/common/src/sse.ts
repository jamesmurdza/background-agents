/**
 * Server-Sent Events (SSE) utilities
 * Provides reusable utilities for creating and parsing SSE streams
 */

// =============================================================================
// Types
// =============================================================================

export interface SSEEvent {
  type: string
  [key: string]: unknown
}

export interface StreamController {
  /** Send a data event to the client */
  send: (data: Record<string, unknown>) => void
  /** Check if the stream has been cancelled */
  isCancelled: () => boolean
  /** Mark the stream as cancelled (called internally on error/close) */
  markCancelled: () => void
}

export interface StreamOptions {
  /**
   * Called when the stream starts
   * Use controller.send() to send events to the client
   */
  onStart: (controller: StreamController) => Promise<void>

  /**
   * Called when the client disconnects (optional)
   * Use for cleanup like saving partial data to the database
   */
  onCancel?: () => void | Promise<void>
}

export interface ProgressEvent {
  type: "progress"
  message: string
  percent?: number
}

export interface ErrorEvent {
  type: "error"
  message: string
}

export interface DoneEvent {
  type: "done"
  [key: string]: unknown
}

export type StreamEvent = ProgressEvent | ErrorEvent | DoneEvent | Record<string, unknown>

// =============================================================================
// Constants
// =============================================================================

/** Standard SSE response headers */
export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
} as const

// =============================================================================
// Server-Side: Creating SSE Streams
// =============================================================================

/**
 * Creates a Server-Sent Events streaming response
 *
 * @example
 * ```ts
 * return createSSEStream({
 *   onStart: async (controller) => {
 *     controller.send({ type: "progress", message: "Starting..." })
 *     await doWork()
 *     controller.send({ type: "done" })
 *   },
 *   onCancel: () => {
 *     // Clean up if client disconnects
 *   }
 * })
 * ```
 */
export function createSSEStream(options: StreamOptions): Response {
  const { onStart, onCancel } = options
  const encoder = new TextEncoder()
  let cancelled = false

  const stream = new ReadableStream({
    async start(controller) {
      const streamController: StreamController = {
        send: (data: Record<string, unknown>) => {
          if (cancelled) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
          } catch {
            // Controller is closed/cancelled, ignore the error
            cancelled = true
          }
        },
        isCancelled: () => cancelled,
        markCancelled: () => {
          cancelled = true
        },
      }

      try {
        await onStart(streamController)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        streamController.send({ type: "error", message })
      }

      controller.close()
    },
    cancel() {
      cancelled = true
      if (onCancel) {
        // Run cleanup async, don't need to wait
        Promise.resolve(onCancel()).catch(() => {})
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

/**
 * Helper to send a progress event
 */
export function sendProgress(controller: StreamController, message: string, percent?: number) {
  controller.send({ type: "progress", message, ...(percent !== undefined && { percent }) })
}

/**
 * Helper to send an error event
 */
export function sendError(controller: StreamController, message: string) {
  controller.send({ type: "error", message })
}

/**
 * Helper to send a done event with optional extra data
 */
export function sendDone(controller: StreamController, data?: Record<string, unknown>) {
  controller.send({ type: "done", ...data })
}

// =============================================================================
// Client-Side: Parsing SSE Streams
// =============================================================================

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
