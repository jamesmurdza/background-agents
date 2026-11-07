import { Daytona } from "@daytonaio/sdk"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"
import { ensureSandboxRunning } from "@/lib/sandbox"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  serverConfigError,
  internalError,
  getGitHubToken,
} from "@/lib/db/api-helpers"

/**
 * POST /api/chats/[chatId]/sandbox/ensure
 *
 * Make sure a chat has a running sandbox, without touching messages, agent
 * runs, or turns. For actions that need a live sandbox but aren't sending a
 * message — e.g. opening a Terminal or revealing the VS Code SSH link for a
 * chat that was just materialized from a draft, or the Merge dialog's
 * materialize-then-merge flow.
 *
 * Reuses the chat's existing sandbox if it's still alive; otherwise creates
 * one via the same path as first-time creation / recreation after expiry
 * (see `ensureSandboxRunning` in lib/sandbox.ts).
 *
 * `/api/chats/[chatId]/sandbox/recreate` re-exports this same handler — the
 * two routes are behaviorally identical, `recreate` just gives the preview
 * panel a URL matching its "recreate" mental model.
 *
 * Body: {} (chatId comes from the route param)
 * Responses:
 *   200 { sandboxId, previewUrlPattern, branch }
 *   404 — chat not found / not owned by caller
 *   410 { error: "SANDBOX_NOT_FOUND" } — cloned repo with no GitHub token to
 *     (re)clone (the one genuinely unrecoverable case, same as ensure-sandbox.ts)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const { chatId } = await params

  const auth = await requireAuth()
  if (isAuthError(auth)) return auth

  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")
  const daytona = new Daytona({ apiKey: daytonaApiKey })

  const isNewRepo = chat.repo === NEW_REPOSITORY || chat.repo === "__new__"
  const githubToken = isNewRepo ? null : await getGitHubToken(auth.userId)

  try {
    const ensured = await ensureSandboxRunning({ daytona, chat, userId: auth.userId, githubToken })
    if (!ensured) {
      return Response.json(
        { error: "SANDBOX_NOT_FOUND", message: "Sandbox not found. GitHub re-authentication required to recreate." },
        { status: 410 }
      )
    }

    return Response.json({
      sandboxId: ensured.sandboxId,
      previewUrlPattern: ensured.previewUrlPattern ?? null,
      branch: ensured.branch,
    })
  } catch (error) {
    await prisma.chat.update({ where: { id: chatId }, data: { status: "error" } }).catch(() => {})
    return internalError(error)
  }
}
