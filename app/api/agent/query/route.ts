import { ensureSandboxReady } from "@/lib/sandbox-resume"

export const maxDuration = 300 // 5 minute timeout for agent queries

export async function POST(req: Request) {
  const body = await req.json()
  const {
    daytonaApiKey,
    sandboxId,
    contextId,
    prompt,
    previewUrlPattern,
    repoName,
    anthropicApiKey,
    anthropicAuthType,
    anthropicAuthToken,
  } = body

  if (!daytonaApiKey || !sandboxId || !prompt) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        // Use resume helper to ensure sandbox + agent are ready
        const { sandbox, contextId: activeContextId, wasResumed } = await ensureSandboxReady(
          daytonaApiKey,
          sandboxId,
          repoName || "repo",
          previewUrlPattern,
          anthropicApiKey,
          anthropicAuthType,
          anthropicAuthToken,
        )

        // If context was re-created after resume, notify frontend
        if (wasResumed) {
          send({ type: "context-updated", contextId: activeContextId })
        }

        // Reset auto-stop timer
        try {
          await sandbox.refreshActivity()
        } catch {
          // Non-critical
        }

        // Find the context to use
        const contexts = await sandbox.codeInterpreter.listContexts()
        const ctx = contexts.find((c) => c.id === activeContextId)
        if (!ctx) {
          throw new Error(
            "Agent context not found. The sandbox may have been reset. Please create a new branch."
          )
        }

        // Run the query with streaming output
        const result = await sandbox.codeInterpreter.runCode(
          `coding_agent.run_query_sync(os.environ.get('PROMPT', ''))`,
          {
            context: ctx,
            envs: { PROMPT: prompt, ...(previewUrlPattern ? { PREVIEW_URL_PATTERN: previewUrlPattern } : {}) },
            onStdout: (msg) => {
              const text = msg.output
              // Parse SESSION_ID: prefix from agent stdout
              if (text.startsWith("SESSION_ID:")) {
                const sessionId = text.replace("SESSION_ID:", "").trim()
                if (sessionId) {
                  send({ type: "session-id", sessionId })
                }
                return
              }
              send({ type: "stdout", content: text })
            },
            onStderr: (msg) => {
              send({ type: "stderr", content: msg.output })
            },
          }
        )

        if (result.error) {
          send({ type: "error", message: result.error.value })
        }

        send({ type: "done" })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        send({ type: "error", message })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
