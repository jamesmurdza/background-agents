import { Daytona } from "@daytonaio/sdk"

export const maxDuration = 300 // 5 minute timeout for agent queries

export async function POST(req: Request) {
  const body = await req.json()
  const { daytonaApiKey, sandboxId, contextId, prompt, previewUrlPattern } = body

  if (!daytonaApiKey || !sandboxId || !contextId || !prompt) {
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
        const daytona = new Daytona({ apiKey: daytonaApiKey })
        const sandbox = await daytona.get(sandboxId)

        // Ensure sandbox is running
        try {
          await sandbox.start()
        } catch {
          // Already started or starting
        }

        // Find the context
        const contexts = await sandbox.codeInterpreter.listContexts()
        const ctx = contexts.find((c) => c.id === contextId)
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
              send({ type: "stdout", content: msg.output })
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
