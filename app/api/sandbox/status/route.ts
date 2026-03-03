import { Daytona } from "@daytonaio/sdk"

export async function POST(req: Request) {
  const body = await req.json()
  const { daytonaApiKey, sandboxId } = body

  if (!daytonaApiKey || !sandboxId) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)
    return Response.json({ state: sandbox.state })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
