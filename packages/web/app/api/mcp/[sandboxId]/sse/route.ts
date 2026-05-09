/**
 * MCP Proxy — JSON-RPC ↔ Smithery REST bridge
 *
 * The agent (in a Daytona sandbox) speaks raw MCP JSON-RPC to this endpoint.
 * We translate each method into Smithery's REST API using the user's
 * connectionId. Smithery is just transport — auth comes from a short-lived
 * installation token minted from our own GitHub App and passed to Smithery
 * as the connection's Authorization header.
 *
 * Flow:
 *   1. Agent → POST /api/mcp/[sandboxId]/sse  (JSON-RPC)
 *   2. Server → look up Chat → User.githubAppInstallationId
 *   3. Server → ensure cached installation token is fresh; if we rotated,
 *      push the new header to Smithery's connection
 *   4. Server → smithery.connections.tools.list/call
 *   5. Server → wrap response as MCP JSON-RPC and return to agent
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { parseMcpToolsConfig } from "@/lib/mcp/types"
import {
  getSmithery,
  SMITHERY_NAMESPACE,
  setGithubConnectionAuth,
} from "@/lib/mcp/smithery-client"
import { getInstallationToken } from "@/lib/github/app"

// =============================================================================
// Types
// =============================================================================

interface McpRequest {
  jsonrpc: "2.0"
  id: string | number
  method: string
  params?: unknown
}

interface McpResponse {
  jsonrpc: "2.0"
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface ChatLookup {
  chatId: string
  userId: string
  mcpTools: unknown
  githubAppInstallationId: string
  smitheryGithubConnectionId: string
}

// =============================================================================
// Helpers
// =============================================================================

async function getChatContext(
  sandboxId: string
): Promise<
  | { chat: ChatLookup; connectionId: string }
  | { error: "chat_not_found" | "github_not_connected" | "tools_disabled" }
> {
  const chat = await prisma.chat.findFirst({
    where: { sandboxId },
    select: {
      id: true,
      userId: true,
      mcpTools: true,
      user: {
        select: {
          githubAppInstallationId: true,
          smitheryGithubConnectionId: true,
        },
      },
    },
  })

  if (!chat) {
    console.warn(`[MCP-proxy] No chat found for sandboxId=${sandboxId}`)
    return { error: "chat_not_found" }
  }

  const tools = parseMcpToolsConfig(chat.mcpTools)
  if (!tools?.github) {
    console.warn(
      `[MCP-proxy] GitHub MCP not enabled for chat ${chat.id} — mcpTools=${JSON.stringify(
        chat.mcpTools
      )}`
    )
    return { error: "tools_disabled" }
  }

  const installationId = chat.user.githubAppInstallationId
  const connectionId = chat.user.smitheryGithubConnectionId
  if (!installationId || !connectionId) {
    console.warn(
      `[MCP-proxy] User ${chat.userId} hasn't completed the GitHub App install — installationId=${installationId} connectionId=${connectionId}`
    )
    return { error: "github_not_connected" }
  }

  return {
    chat: {
      chatId: chat.id,
      userId: chat.userId,
      mcpTools: chat.mcpTools,
      githubAppInstallationId: installationId,
      smitheryGithubConnectionId: connectionId,
    },
    connectionId,
  }
}

/**
 * Make sure Smithery has a non-expired installation token. We mint/refresh
 * here (rather than on a timer) so a long-idle session refreshes lazily on
 * its first use. When the token rotated, also push it to Smithery so the
 * upstream MCP call sees the new value.
 */
async function ensureFreshAuthHeader(chat: ChatLookup): Promise<void> {
  const fresh = await getInstallationToken(chat.githubAppInstallationId)
  if (fresh.rotated) {
    await setGithubConnectionAuth({
      userId: chat.userId,
      installationToken: fresh.token,
    })
  }
}

function ok(id: string | number, result: unknown): McpResponse {
  return { jsonrpc: "2.0", id, result }
}

function err(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }
}

// =============================================================================
// MCP method handlers
// =============================================================================

async function handleInitialize(req: McpRequest): Promise<McpResponse> {
  return ok(req.id, {
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
    serverInfo: {
      name: "simple-chat-mcp-proxy",
      version: "1.0.0",
    },
  })
}

async function handleToolsList(
  req: McpRequest,
  chat: ChatLookup
): Promise<McpResponse> {
  const smithery = getSmithery()
  try {
    await ensureFreshAuthHeader(chat)
    const list = await smithery.connections.tools.list(
      chat.smitheryGithubConnectionId,
      { namespace: SMITHERY_NAMESPACE }
    )
    // Smithery's Tool shape is already MCP-compatible (name, description,
    // inputSchema). Pass it straight through.
    return ok(req.id, { tools: list.tools })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[MCP-proxy] tools/list failed: ${msg}`)
    return err(req.id, -32000, `tools/list failed: ${msg}`)
  }
}

async function handleToolsCall(
  req: McpRequest,
  chat: ChatLookup
): Promise<McpResponse> {
  const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
  const toolName = params.name
  const args = params.arguments ?? {}

  if (!toolName) {
    return err(req.id, -32602, "Missing 'name' in tools/call params")
  }

  const smithery = getSmithery()
  try {
    await ensureFreshAuthHeader(chat)
    const result = await smithery.connections.tools.call(toolName, {
      namespace: SMITHERY_NAMESPACE,
      connectionId: chat.smitheryGithubConnectionId,
      body: args,
    })
    // Smithery returns the upstream MCP tool result as-is. If it already has
    // the MCP `content` shape, pass it through; otherwise wrap a JSON string.
    if (result && typeof result === "object" && Array.isArray((result as { content?: unknown }).content)) {
      return ok(req.id, result)
    }
    return ok(req.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[MCP-proxy] tools/call ${toolName} failed: ${msg}`)
    return ok(req.id, {
      content: [{ type: "text", text: `Tool error: ${msg}` }],
      isError: true,
    })
  }
}

// =============================================================================
// HTTP handlers
// =============================================================================

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sandboxId: string }> }
): Promise<Response> {
  const { sandboxId } = await params
  console.log(`[MCP-proxy] POST /api/mcp/${sandboxId}/sse`)

  // Parse JSON-RPC first so we can echo the id back on errors
  let mcpRequest: McpRequest
  try {
    mcpRequest = await req.json()
  } catch {
    return Response.json(err(0, -32700, "Parse error"), { status: 400 })
  }

  // Notifications don't get a response
  if (mcpRequest.method === "notifications/initialized") {
    return new Response(null, { status: 204 })
  }

  // Look up the chat → user → connectionId
  const ctx = await getChatContext(sandboxId)
  if ("error" in ctx) {
    const codes: Record<typeof ctx.error, number> = {
      chat_not_found: -32001,
      tools_disabled: -32002,
      github_not_connected: -32003,
    }
    return Response.json(err(mcpRequest.id, codes[ctx.error], ctx.error), {
      status: ctx.error === "chat_not_found" ? 404 : 403,
    })
  }

  let response: McpResponse
  switch (mcpRequest.method) {
    case "initialize":
      response = await handleInitialize(mcpRequest)
      break
    case "tools/list":
      response = await handleToolsList(mcpRequest, ctx.chat)
      break
    case "tools/call":
      response = await handleToolsCall(mcpRequest, ctx.chat)
      break
    case "ping":
      response = ok(mcpRequest.id, {})
      break
    default:
      response = err(mcpRequest.id, -32601, `Method not found: ${mcpRequest.method}`)
  }

  console.log(
    JSON.stringify({
      type: "mcp_request",
      timestamp: new Date().toISOString(),
      userId: ctx.chat.userId,
      chatId: ctx.chat.chatId,
      sandboxId,
      method: mcpRequest.method,
      tool:
        mcpRequest.method === "tools/call"
          ? (mcpRequest.params as { name?: string })?.name
          : undefined,
      success: !response.error,
    })
  )

  return Response.json(response)
}

// Some MCP clients try to open an SSE stream first to discover the endpoint.
// We don't proactively push events, so we just acknowledge with a minimal
// stream and let the client move on to POST.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sandboxId: string }> }
): Promise<Response> {
  const { sandboxId } = await params
  console.log(`[MCP-proxy] GET /api/mcp/${sandboxId}/sse`)

  const ctx = await getChatContext(sandboxId)
  if ("error" in ctx) {
    const status = ctx.error === "chat_not_found" ? 404 : 403
    return new Response(ctx.error, { status })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const event = {
        jsonrpc: "2.0",
        method: "server/info",
        params: {
          name: "simple-chat-mcp-proxy",
          version: "1.0.0",
        },
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
