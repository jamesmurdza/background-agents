import { Daytona } from "@daytonaio/sdk"
import { ensureSandboxStarted } from "@/lib/sandbox"
import { escapeShell } from "@background-agents/common"

export const maxDuration = 30

const BINARY_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  pdf: "application/pdf",
}

function getBinaryContentType(filePath: string): string {
  const ext = filePath.split("/").pop()?.toLowerCase().split(".").pop() ?? ""
  return BINARY_CONTENT_TYPES[ext] ?? "application/octet-stream"
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as {
    sandboxId?: string
    action?: string
    filePath?: string
    maxLines?: number
  } | null

  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 })

  const { sandboxId, action, filePath } = body

  if (!sandboxId || !action) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox
    try {
      sandbox = await daytona.get(sandboxId)
    } catch {
      return Response.json({ error: "SANDBOX_NOT_FOUND" }, { status: 410 })
    }
    await ensureSandboxStarted(sandbox)

    switch (action) {
      case "read-file": {
        if (!filePath) return Response.json({ error: "Missing filePath" }, { status: 400 })
        const safe = escapeShell(filePath)
        const maxLines = body.maxLines

        const statResult = await sandbox.process.executeCommand(
          `stat --format='%Y|%s' '${safe}' 2>/dev/null || echo 'error'`
        )
        if (statResult.result?.trim() === "error" || statResult.exitCode !== 0) {
          return Response.json({ error: "File not found" }, { status: 404 })
        }
        const [mtimeStr, sizeStr] = statResult.result.trim().split("|")
        const mtime = parseInt(mtimeStr, 10)
        const size = parseInt(sizeStr, 10)

        // 500 KB cap for full reads (maxLines request skips this).
        if (!maxLines && size > 500 * 1024) {
          return Response.json(
            { error: "File too large", path: filePath, size, modifiedAt: mtime * 1000 },
            { status: 413 }
          )
        }

        const readCmd = maxLines
          ? `head -n ${maxLines} '${safe}' 2>/dev/null`
          : `cat '${safe}' 2>/dev/null`
        const readResult = await sandbox.process.executeCommand(readCmd)
        const content = readResult.result || ""
        const truncated = !!maxLines && content.split("\n").length >= maxLines

        return Response.json({
          path: filePath,
          content,
          modifiedAt: mtime * 1000,
          size,
          truncated,
        })
      }

      case "read-file-binary": {
        if (!filePath) return Response.json({ error: "Missing filePath" }, { status: 400 })
        const safe = escapeShell(filePath)

        const statResult = await sandbox.process.executeCommand(
          `stat --format='%Y|%s' '${safe}' 2>/dev/null || echo 'error'`
        )
        if (statResult.result?.trim() === "error" || statResult.exitCode !== 0) {
          return Response.json({ error: "File not found" }, { status: 404 })
        }
        const [, sizeStr] = statResult.result.trim().split("|")
        const size = parseInt(sizeStr, 10)

        // 10 MB cap for binary previews (images/PDFs).
        if (size > 10 * 1024 * 1024) {
          return Response.json(
            { error: "File too large", path: filePath, size },
            { status: 413 }
          )
        }

        const buffer = await sandbox.fs.downloadFile(filePath)

        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": getBinaryContentType(filePath),
            "Content-Length": buffer.length.toString(),
          },
        })
      }

      case "list-servers": {
        const ss = await sandbox.process.executeCommand(
          `ss -tlnp 2>/dev/null | grep -E 'LISTEN.*:(3[0-9]{3}|4[0-9]{3}|5[0-9]{3}|6[0-9]{3}|7[0-9]{3}|8[0-9]{3}|9[0-9]{3})' | awk '{print $4}' | sed 's/.*://' | sort -n | uniq || true`,
          undefined,
          undefined,
          10
        )
        const ports: number[] = []
        for (const line of (ss.result || "").trim().split("\n").filter(Boolean)) {
          const port = parseInt(line.trim(), 10)
          if (!isNaN(port) && port >= 3000 && port <= 9999) ports.push(port)
        }
        return Response.json({ ports })
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }
  } catch (error) {
    console.error("[sandbox/files] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
