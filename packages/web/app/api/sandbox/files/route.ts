import { Daytona } from "@daytonaio/sdk"
import { ensureSandboxStarted } from "@/lib/sandbox"
import { getSandboxOrExpired, passiveReadGate } from "@/lib/sandbox-lifecycle"
import { escapeShell } from "@background-agents/sdk"
import { PATHS } from "@background-agents/common"
import { IMAGE_MIME_TYPES } from "@/lib/file-preview/types"
import { LIST_SERVERS_COMMAND, parseListeningSockets, recordDevServers } from "@/lib/dev-servers"
import { readDevServers, saveDevServers } from "@/lib/db/dev-servers-store"
import { internalError, badRequest, notFound, requireSandboxOwner, getGitHubToken, serverConfigError } from "@/lib/db/api-helpers"
import { prisma } from "@/lib/db/prisma"
import { inspectChanges } from "@/lib/git/changes"
import { pickerPort, startElementPicker } from "@/lib/element-picker-sandbox"

// maxDuration configures the timeout for this Vercel function.
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
    /** Dev server port, for start-element-picker. */
    port?: number
  } | null

  if (!body) return badRequest("Invalid JSON body")

  const { sandboxId, action, filePath } = body

  if (!sandboxId || !action) {
    return badRequest("Missing required fields")
  }

  const owner = await requireSandboxOwner(sandboxId)
  if (owner instanceof Response) return owner

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return serverConfigError("DAYTONA_API_KEY")
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await getSandboxOrExpired(daytona, sandboxId)
    if (sandbox instanceof Response) return sandbox

    // Per-action sandbox lifecycle. A stopped sandbox must only be booted by an
    // explicit user action — never by background/passive traffic:
    //   - `list-servers` is a 5s background poll; a stopped sandbox has no
    //     listening servers, so we answer `{ ports: [] }` without starting it
    //     (and without keeping an idle sandbox alive).
    //   - `read-file`/`read-file-binary`/`list-dir`/`list-changes` from the
    //     file-viewer, file-browser and changes panels are passive; they omit
    //     `autoStart` and get a 409 SANDBOX_STOPPED (via `passiveReadGate`) so
    //     the UI can offer a Resume action instead of silently spinning the
    //     sandbox up.
    // When the sandbox is already started we fall through to the normal
    // `ensureSandboxStarted` (a no-op start that still runs its usual checks).
    if (sandbox.state !== "started" && action === "list-servers") {
      return Response.json({ ports: [] })
    }
    if (action === "read-file" || action === "read-file-binary" || action === "list-dir" || action === "list-changes") {
      const halt = passiveReadGate(sandbox, body.autoStart)
      if (halt) return halt
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

      case "list-dir": {
        const resolvedPath = filePath ? resolveFilePath(filePath) : PATHS.SANDBOX_HOME
        const safe = escapeShell(resolvedPath)

        const typeCheck = await sandbox.process.executeCommand(
          `[ -d '${safe}' ] && echo 'dir' || echo 'missing'`
        )
        if (typeCheck.result?.trim() !== "dir") {
          return notFound(`Directory not found: ${resolvedPath}`)
        }

        // One line per entry: "f|name|size|mtime" or "d|name|0|mtime". `-A`
        // includes dotfiles but skips "." and "..". `%f` is the bare filename
        // (no path), so names with spaces still parse as one field.
        const listCmd = `cd '${safe}' && find . -mindepth 1 -maxdepth 1 -printf '%y|%f|%s|%T@\\n' | sort -t'|' -k1,1r -k2,2`
        const listResult = await sandbox.process.executeCommand(listCmd)
        const entries = (listResult.result || "")
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [kind, name, sizeStr, mtimeStr] = line.split("|")
            return {
              name,
              isDirectory: kind === "d",
              size: parseInt(sizeStr, 10) || 0,
              modifiedAt: Math.round(parseFloat(mtimeStr) * 1000) || 0,
            }
          })

        return Response.json({ path: resolvedPath, entries })
      }

      case "list-changes": {
        // The base branch comes from the chat, not the request.
        const chat = await prisma.chat.findFirst({
          where: { sandboxId, userId: owner.userId },
          select: { baseBranch: true },
        })
        if (!chat) return notFound("Chat not found")
        const token = await getGitHubToken(owner.userId)
        try {
          return Response.json(await inspectChanges(sandbox, PATHS.PROJECT_DIR, chat.baseBranch, token ?? undefined))
        } catch (error) {
          return badRequest(error instanceof Error ? error.message : "Couldn't read the changes")
        }
      }

      case "list-servers": {
        // Read listening TCP sockets straight from the kernel via /proc, which
        // is always present on Linux. We intentionally do NOT use `ss`/`netstat`
        // here: those come from iproute2/net-tools, which are not installed in
        // the sandbox image, so a previous `ss`-based implementation silently
        // returned nothing and the preview never opened.
        //
        // This poll is also the only chance to learn how each server was
        // started: the command can only be read off a live process, but it is
        // only needed once the sandbox has stopped and the processes are gone.
        // So any port not already recorded is attributed now and persisted to
        // the chat, which is what lets a later refresh restart it.
        const proc = await sandbox.process.executeCommand(
          LIST_SERVERS_COMMAND,
          undefined,
          undefined,
          10
        )
        const sockets = parseListeningSockets(proc.result || "")
        const known = await readDevServers(sandboxId)
        const unknown = sockets.filter((s) => !known.has(s.port))
        if (unknown.length > 0) {
          await saveDevServers(sandboxId, await recordDevServers(sandbox, unknown))
        }
        return Response.json({ ports: sockets.map((s) => s.port) })
      }

      case "start-element-picker": {
        // "Select element" in the Live Preview; see lib/element-picker.ts. The
        // port goes into a shell command, so it must be a plain number.
        const port = Number(body.port)
        if (!Number.isInteger(port) || port < 3000 || port > 9999) return badRequest("Invalid port")
        const result = await startElementPicker(sandbox, port)
        if (result.state === "failed") {
          console.error("[sandbox/files] element picker failed to start:", result.log)
          return internalError(new Error("The element picker failed to start"))
        }
        const link = await sandbox.getPreviewLink(pickerPort(port))
        return Response.json({ url: link.url })
      }

      default:
        return badRequest(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error("[sandbox/files] Error:", error)
    return internalError(error)
  }
}
