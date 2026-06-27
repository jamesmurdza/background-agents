import { Daytona } from "@daytonaio/sdk"
import { ensureSandboxStarted } from "@/lib/sandbox"
import { escapeShell } from "@background-agents/sdk"
import { PATHS } from "@background-agents/common"
import { IMAGE_MIME_TYPES } from "@/lib/file-preview/types"
import { internalError, badRequest, notFound } from "@/lib/db/api-helpers"

export const maxDuration = 30

/**
 * Resolve a file path to an absolute sandbox path. Paths that already start
 * with "/" are used as-is; relative paths (e.g. "screenshot.png" or
 * "test-results/shot.png") are resolved against the repo dir, which is the
 * agent's working directory. Without this, a relative path would be looked up
 * relative to the command shell's cwd and fail with "File not found".
 */
function resolveFilePath(filePath: string): string {
  return filePath.startsWith("/") ? filePath : `${PATHS.PROJECT_DIR}/${filePath}`
}

const BINARY_CONTENT_TYPES: Record<string, string> = {
  ...IMAGE_MIME_TYPES,
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
    /**
     * When true, an explicit user action (e.g. the download button) is asking
     * to boot a stopped sandbox. Passive reads (the file-viewer panel) omit it
     * so they never resurrect an idle sandbox; see the lifecycle block below.
     */
    autoStart?: boolean
  } | null

  if (!body) return badRequest("Invalid JSON body")

  const { sandboxId, action, filePath } = body

  if (!sandboxId || !action) {
    return badRequest("Missing required fields")
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
    // Per-action sandbox lifecycle. A stopped sandbox must only be booted by an
    // explicit user action — never by background/passive traffic:
    //   - `list-servers` is a 5s background poll; a stopped sandbox has no
    //     listening servers, so we answer `{ ports: [] }` without starting it
    //     (and without keeping an idle sandbox alive).
    //   - `read-file`/`read-file-binary` from the file-viewer panel are passive;
    //     they omit `autoStart` and get a 409 SANDBOX_STOPPED so the UI can offer
    //     a Resume action instead of silently spinning the sandbox up.
    // When the sandbox is already started we fall through to the normal
    // `ensureSandboxStarted` (a no-op start that still runs its usual checks).
    if (sandbox.state !== "started") {
      if (action === "list-servers") {
        return Response.json({ ports: [] })
      }
      if (
        (action === "read-file" || action === "read-file-binary") &&
        !body.autoStart
      ) {
        return Response.json({ error: "SANDBOX_STOPPED" }, { status: 409 })
      }
    }

    await ensureSandboxStarted(sandbox)

    switch (action) {
      case "read-file": {
        if (!filePath) return badRequest("Missing filePath")
        const resolvedPath = resolveFilePath(filePath)
        const safe = escapeShell(resolvedPath)
        const maxLines = body.maxLines

        const statResult = await sandbox.process.executeCommand(
          `stat --format='%Y|%s' '${safe}' 2>/dev/null || echo 'error'`
        )
        if (statResult.result?.trim() === "error" || statResult.exitCode !== 0) {
          return notFound(`File not found: ${resolvedPath}`)
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
        if (!filePath) return badRequest("Missing filePath")
        const resolvedPath = resolveFilePath(filePath)
        const safe = escapeShell(resolvedPath)

        const statResult = await sandbox.process.executeCommand(
          `stat --format='%Y|%s' '${safe}' 2>/dev/null || echo 'error'`
        )
        if (statResult.result?.trim() === "error" || statResult.exitCode !== 0) {
          return notFound(`File not found: ${resolvedPath}`)
        }
        const [, sizeStr] = statResult.result.trim().split("|")
        const size = parseInt(sizeStr, 10)

        // 10 MB cap for binary previews (images/PDFs).
        if (size > 10 * 1024 * 1024) {
          return Response.json(
            { error: "File too large", path: resolvedPath, size },
            { status: 413 }
          )
        }

        const buffer = await sandbox.fs.downloadFile(resolvedPath)

        return new Response(new Uint8Array(buffer), {
          status: 200,
          headers: {
            "Content-Type": getBinaryContentType(filePath),
            "Content-Length": buffer.length.toString(),
          },
        })
      }

      case "list-servers": {
        // Read listening TCP sockets straight from the kernel via /proc, which
        // is always present on Linux. We intentionally do NOT use `ss`/`netstat`
        // here: those come from iproute2/net-tools, which are not installed in
        // the sandbox image, so a previous `ss`-based implementation silently
        // returned nothing and the preview never opened.
        const proc = await sandbox.process.executeCommand(
          `cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true`,
          undefined,
          undefined,
          10
        )
        const ports = new Set<number>()
        for (const line of (proc.result || "").split("\n")) {
          // Columns: "sl local_address rem_address st ...". Skip the header
          // (starts with "sl") and any blank lines.
          const cols = line.trim().split(/\s+/)
          if (cols.length < 4 || cols[0] === "sl") continue
          // st === "0A" is TCP_LISTEN. local_address is "HEXIP:HEXPORT".
          if (cols[3] !== "0A") continue
          const hexPort = cols[1].split(":")[1]
          const port = parseInt(hexPort, 16)
          if (!isNaN(port) && port >= 3000 && port <= 9999) ports.add(port)
        }
        return Response.json({ ports: [...ports].sort((a, b) => a - b) })
      }

      default:
        return badRequest(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error("[sandbox/files] Error:", error)
    return internalError(error)
  }
}
