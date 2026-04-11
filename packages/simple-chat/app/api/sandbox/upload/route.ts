import { Daytona } from "@daytonaio/sdk"

export const maxDuration = 60 // 1 minute

export async function POST(req: Request) {
  // 1. Parse FormData
  const formData = await req.formData()
  const sandboxId = formData.get("sandboxId") as string
  const repoPath = formData.get("repoPath") as string

  if (!sandboxId) {
    return Response.json({ error: "Missing required field: sandboxId" }, { status: 400 })
  }
  if (!repoPath) {
    return Response.json({ error: "Missing required field: repoPath" }, { status: 400 })
  }

  // Get all files from formData
  const files: File[] = []
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("file-") && value instanceof File) {
      files.push(value)
    }
  }

  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 })
  }

  // 2. Get Daytona API key
  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json(
      { error: "Daytona API key not configured" },
      { status: 500 }
    )
  }

  try {
    // 3. Get sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)

    // 4. Upload each file with conflict resolution
    const uploadedFiles: { originalName: string; path: string; size: number }[] = []

    for (const file of files) {
      const originalName = file.name
      const resolvedName = await resolveFilename(sandbox, repoPath, originalName)
      const destPath = `${repoPath}/${resolvedName}`

      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Upload the file
      await sandbox.fs.uploadFile(buffer, destPath)

      uploadedFiles.push({
        originalName,
        path: destPath,
        size: file.size,
      })
    }

    return Response.json({ uploadedFiles })
  } catch (error) {
    console.error("[sandbox/upload] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}

/**
 * Resolve filename conflicts by appending -1, -2, etc.
 * e.g., if "file.png" exists, returns "file-1.png"
 */
async function resolveFilename(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string,
  filename: string
): Promise<string> {
  // Check if file exists
  const exists = await fileExists(sandbox, `${repoPath}/${filename}`)
  if (!exists) {
    return filename
  }

  // Split filename into name and extension
  const lastDotIndex = filename.lastIndexOf(".")
  const hasExtension = lastDotIndex > 0
  const baseName = hasExtension ? filename.slice(0, lastDotIndex) : filename
  const extension = hasExtension ? filename.slice(lastDotIndex) : ""

  // Find a unique name
  let counter = 1
  while (counter < 100) {
    const newName = `${baseName}-${counter}${extension}`
    const newExists = await fileExists(sandbox, `${repoPath}/${newName}`)
    if (!newExists) {
      return newName
    }
    counter++
  }

  // Fallback: add timestamp
  const timestamp = Date.now()
  return `${baseName}-${timestamp}${extension}`
}

/**
 * Check if a file exists in the sandbox
 */
async function fileExists(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  path: string
): Promise<boolean> {
  try {
    const result = await sandbox.process.executeCommand(`test -e "${path}" && echo "exists"`)
    return result.output?.trim() === "exists"
  } catch {
    return false
  }
}
