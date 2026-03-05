import { Daytona } from "@daytonaio/sdk"

export const maxDuration = 120 // 2 minute timeout

interface SandboxAuthUpdate {
  sandboxId: string
  success: boolean
  error?: string
}

export async function POST(req: Request) {
  const body = await req.json()
  const {
    daytonaApiKey,
    anthropicApiKey,
    anthropicAuthType,
    anthropicAuthToken,
    sandboxIds,
  } = body

  if (!daytonaApiKey) {
    return Response.json({ error: "Missing Daytona API key" }, { status: 400 })
  }

  const hasAnthropicCredential =
    (anthropicAuthType === "claude-max" && anthropicAuthToken) ||
    (anthropicAuthType !== "claude-max" && anthropicApiKey)

  if (!hasAnthropicCredential) {
    return Response.json({ error: "Missing Anthropic credentials" }, { status: 400 })
  }

  if (!sandboxIds || !Array.isArray(sandboxIds) || sandboxIds.length === 0) {
    return Response.json({ error: "No sandbox IDs provided" }, { status: 400 })
  }

  const daytona = new Daytona({ apiKey: daytonaApiKey })
  const results: SandboxAuthUpdate[] = []

  // Update credentials in each sandbox
  for (const sandboxId of sandboxIds) {
    try {
      const sandbox = await daytona.get(sandboxId)

      // Only update running sandboxes
      if (sandbox.state !== "started") {
        results.push({
          sandboxId,
          success: true, // Skip but consider success - will be updated on next resume
        })
        continue
      }

      if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
        // Write Claude Max credentials to file
        const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
        const result = await sandbox.process.executeCommand(
          `mkdir -p /home/daytona/.claude && echo '${credentialsB64}' | base64 -d > /home/daytona/.claude/.credentials.json && chmod 600 /home/daytona/.claude/.credentials.json`
        )
        if (result.exitCode !== 0) {
          throw new Error(`Failed to write credentials: ${result.result}`)
        }
      } else if (anthropicApiKey) {
        // For API key mode, we need to update the environment variable
        // The API key is passed via code interpreter envs on each query,
        // so we just need to make sure we're not using stale Claude Max credentials
        // Remove any existing Claude Max credentials file to avoid confusion
        await sandbox.process.executeCommand(
          `rm -f /home/daytona/.claude/.credentials.json 2>/dev/null || true`
        )
      }

      results.push({ sandboxId, success: true })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error"
      results.push({ sandboxId, success: false, error: message })
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failureCount = results.filter((r) => !r.success).length

  return Response.json({
    success: failureCount === 0,
    updated: successCount,
    failed: failureCount,
    results,
  })
}
