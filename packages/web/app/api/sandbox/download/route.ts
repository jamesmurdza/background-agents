import { Daytona } from "@daytonaio/sdk"
import { PATHS } from "@upstream/common"

export const maxDuration = 60

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    sandboxId?: string
  } | null

  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 })

  const { sandboxId } = body

  if (!sandboxId) {
    return Response.json({ error: "Missing sandboxId" }, { status: 400 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  // Generate unique temp filename to avoid collisions
  const timestamp = Date.now()
  const tempZipPath = `/tmp/project-${timestamp}.zip`

  let sandbox: Awaited<ReturnType<Daytona["get"]>> | null = null

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      return Response.json({ error: "SANDBOX_NOT_FOUND" }, { status: 410 })
    }

    if (sandbox.state !== "started") {
      await sandbox.start(120)
    }

    // Create zip file in /tmp, excluding .git and node_modules
    const zipCmd = `cd "${PATHS.PROJECT_DIR}" && zip -r "${tempZipPath}" . -x ".git/*" -x "node_modules/*" -x ".git" -x "node_modules"`
    const zipResult = await sandbox.process.executeCommand(zipCmd, undefined, undefined, 120)

    if (zipResult.exitCode !== 0) {
      throw new Error(`Failed to create zip: ${zipResult.result || "Unknown error"}`)
    }

    // Download the zip file using the Daytona SDK
    const zipBuffer = await sandbox.fs.downloadFile(tempZipPath)

    // Clean up the temp zip file
    await sandbox.process.executeCommand(`rm -f "${tempZipPath}"`)

    // Return the zip file as a binary response
    return new Response(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="project.zip"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    })
  } catch (error) {
    // Always try to clean up the temp file on error
    if (sandbox) {
      try {
        await sandbox.process.executeCommand(`rm -f "${tempZipPath}"`)
      } catch {
        // Ignore cleanup errors
      }
    }

    console.error("[sandbox/download] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
