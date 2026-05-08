import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  getChatWithAuth,
  notFound,
  badRequest,
  internalError,
} from "@/lib/db/api-helpers"
import {
  McpToolsConfig,
  parseMcpToolsConfig,
  agentSupportsMcp,
} from "@/lib/mcp/types"

// =============================================================================
// Types
// =============================================================================

interface McpToolsResponse {
  mcpTools: McpToolsConfig
  agentSupportsMcp: boolean
}

interface PatchMcpToolsBody {
  mcpTools: McpToolsConfig
}

// =============================================================================
// GET - Fetch chat MCP tools settings
// =============================================================================

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    // First verify ownership
    const chatAuth = await getChatWithAuth(chatId, userId)
    if (!chatAuth) {
      return notFound("Chat not found")
    }

    // Get mcpTools field separately (not in getChatWithAuth return type)
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { mcpTools: true, agent: true },
    })

    const mcpTools = parseMcpToolsConfig(chat?.mcpTools) ?? {}

    const response: McpToolsResponse = {
      mcpTools,
      agentSupportsMcp: agentSupportsMcp(chat?.agent ?? ""),
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}

// =============================================================================
// PATCH - Update chat MCP tools settings
// =============================================================================

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult
  const { chatId } = await params

  try {
    const body: PatchMcpToolsBody = await req.json()

    if (!body.mcpTools || typeof body.mcpTools !== "object") {
      return badRequest("Invalid mcpTools")
    }

    // Verify ownership
    const chat = await getChatWithAuth(chatId, userId)
    if (!chat) {
      return notFound("Chat not found")
    }

    // Validate and clean the mcpTools config
    const validatedConfig = parseMcpToolsConfig(body.mcpTools)
    if (!validatedConfig) {
      return badRequest("Invalid mcpTools configuration")
    }

    // Update the chat - cast to JSON-compatible type for Prisma
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        mcpTools: validatedConfig as Record<string, boolean>,
      },
    })

    const response: McpToolsResponse = {
      mcpTools: validatedConfig,
      agentSupportsMcp: agentSupportsMcp(chat.agent),
    }

    return Response.json(response)
  } catch (error) {
    return internalError(error)
  }
}
