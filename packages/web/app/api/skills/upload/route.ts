import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
  serverConfigError,
  getGitHubToken,
  getChatWithAuth,
} from "@/lib/db/api-helpers"
import { PATHS } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { ensureSandboxStarted, recreateChatSandbox } from "@/lib/sandbox"
import { getSandboxOrExpired } from "@/lib/sandbox-lifecycle"
import { getSkillNameFromHandle, installSkillArchive } from "@background-agents/sandbox-skills/sandbox"

// Booting a stopped sandbox can take up to ~120s, plus the install itself.
export const maxDuration = 300

// Vercel rejects request bodies over 4.5 MB, so stay under it.
const MAX_ZIP_SIZE = 4 * 1024 * 1024

// =============================================================================
// POST - Upload a zipped skill, install it in the chat's sandbox, then save it
// for the chat's repo. Uploading the same skill again replaces it.
// =============================================================================

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const form = await req.formData()
    const chatId = form.get("chatId")
    const file = form.get("file")

    if (typeof chatId !== "string" || !chatId) {
      return badRequest("chatId is required")
    }
    if (!(file instanceof File)) {
      return badRequest("file is required")
    }
    if (file.size > MAX_ZIP_SIZE) {
      return badRequest("The zip must be under 4 MB")
    }

    const chat = await getChatWithAuth(chatId, userId)

    if (!chat) {
      return notFound("Chat not found")
    }
    if (!chat.sandboxId) {
      return badRequest("Chat has no sandbox — send a message first")
    }

    // Install first, so a zip that doesn't work is never saved. Buffering the
    // archive before touching the sandbox also means a recreate-and-retry
    // below (if the sandbox expired) has the bytes ready without re-reading
    // the request body.
    const archive = new Uint8Array(await file.arrayBuffer())
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    let sandbox = await getSandboxOrExpired(daytona, chat.sandboxId)
    if (sandbox instanceof Response) {
      const githubToken = chat.repo === NEW_REPOSITORY ? null : await getGitHubToken(userId)
      const recreated = await recreateChatSandbox({ daytona, chat, userId, githubToken })
      if (!recreated) return sandbox
      sandbox = recreated.sandbox
    } else {
      await ensureSandboxStarted(sandbox)
    }
    const result = await installSkillArchive(sandbox, `${PATHS.SANDBOX_HOME}/project`, archive)
    if (!result.success) {
      return badRequest(result.error ?? "Could not install the skill")
    }

    const name = getSkillNameFromHandle(result.fullHandle)
    await prisma.skill.upsert({
      where: {
        userId_repo_fullHandle: { userId, repo: chat.repo, fullHandle: result.fullHandle },
      },
      create: { userId, repo: chat.repo, publisher: "upload", name, fullHandle: result.fullHandle, archive },
      update: { archive },
    })

    return Response.json({ name }, { status: 201 })
  } catch (error) {
    return internalError(error)
  }
}
