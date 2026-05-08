/**
 * MCP SSE Proxy Endpoint
 *
 * This endpoint acts as an MCP server that agents connect to.
 * It proxies tool calls to Smithery's hosted MCP servers.
 *
 * Security:
 * - Token is looked up from database (never sent by agent)
 * - Agent only provides sandboxId for authentication
 * - Tools are scoped to the chat's repository
 */

import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { parseMcpToolsConfig, SMITHERY_MCP_SERVERS } from "@/lib/mcp/types"
import Smithery from "@smithery/api"

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

interface ChatWithUser {
  id: string
  userId: string
  repo: string
  agent: string
  mcpTools: unknown
  user: {
    accounts: Array<{
      provider: string
      access_token: string | null
    }>
  }
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Look up chat by sandboxId and get user's GitHub token
 */
async function getChatAndToken(
  sandboxId: string
): Promise<{ chat: ChatWithUser; githubToken: string } | null> {
  const chat = await prisma.chat.findUnique({
    where: { sandboxId },
    select: {
      id: true,
      userId: true,
      repo: true,
      agent: true,
      mcpTools: true,
      user: {
        select: {
          accounts: {
            where: { provider: "github" },
            select: {
              provider: true,
              access_token: true,
            },
          },
        },
      },
    },
  })

  if (!chat) return null

  const githubAccount = chat.user.accounts[0]
  if (!githubAccount?.access_token) return null

  return {
    chat: chat as ChatWithUser,
    githubToken: githubAccount.access_token,
  }
}

/**
 * Create MCP error response
 */
function mcpError(
  id: string | number,
  code: number,
  message: string
): McpResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  }
}

/**
 * Create MCP success response
 */
function mcpResult(id: string | number, result: unknown): McpResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  }
}

// =============================================================================
// GitHub Tool Definitions (from Smithery's @smithery-ai/github)
// =============================================================================

const GITHUB_TOOLS = [
  {
    name: "search_repositories",
    description: "Search GitHub repositories",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        per_page: { type: "number", default: 30 },
        page: { type: "number", default: 1 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_issue",
    description: "Get details of a specific issue",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue_number: { type: "number" },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in a repository",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        per_page: { type: "number", default: 30 },
        page: { type: "number", default: 1 },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "add_issue_comment",
    description: "Add a comment to an issue",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        issue_number: { type: "number" },
        body: { type: "string" },
      },
      required: ["owner", "repo", "issue_number", "body"],
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests in a repository",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        state: { type: "string", enum: ["open", "closed", "all"], default: "open" },
        per_page: { type: "number", default: 30 },
        page: { type: "number", default: 1 },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_pull_request",
    description: "Get details of a specific pull request",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        pull_number: { type: "number" },
      },
      required: ["owner", "repo", "pull_number"],
    },
  },
  {
    name: "get_pull_request_diff",
    description: "Get the diff of a pull request",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        pull_number: { type: "number" },
      },
      required: ["owner", "repo", "pull_number"],
    },
  },
  {
    name: "search_code",
    description: "Search code in repositories",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        per_page: { type: "number", default: 30 },
        page: { type: "number", default: 1 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_file_contents",
    description: "Get contents of a file",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        path: { type: "string" },
        ref: { type: "string" },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "list_branches",
    description: "List branches in a repository",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        per_page: { type: "number", default: 30 },
        page: { type: "number", default: 1 },
      },
      required: ["owner", "repo"],
    },
  },
]

// =============================================================================
// MCP Protocol Handlers
// =============================================================================

/**
 * Handle MCP initialize request
 */
function handleInitialize(id: string | number): McpResponse {
  return mcpResult(id, {
    protocolVersion: "2024-11-05",
    serverInfo: {
      name: "daytona-mcp-proxy",
      version: "1.0.0",
    },
    capabilities: {
      tools: {},
    },
  })
}

/**
 * Handle MCP tools/list request
 */
function handleToolsList(id: string | number, enabledTools: { github?: boolean }): McpResponse {
  const tools: typeof GITHUB_TOOLS = []

  if (enabledTools.github) {
    tools.push(...GITHUB_TOOLS)
  }

  return mcpResult(id, { tools })
}

/**
 * Handle MCP tools/call request
 */
async function handleToolsCall(
  id: string | number,
  toolName: string,
  args: Record<string, unknown>,
  githubToken: string,
  chatRepo: string
): Promise<McpResponse> {
  // For now, we'll make direct GitHub API calls instead of going through Smithery
  // This is simpler and more direct for the initial implementation

  try {
    const [owner, repo] = chatRepo.split("/")

    // Add owner/repo from chat context if not provided
    const enrichedArgs = {
      owner: args.owner || owner,
      repo: args.repo || repo,
      ...args,
    }

    // Make GitHub API call directly
    const result = await callGitHubAPI(toolName, enrichedArgs, githubToken)

    return mcpResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return mcpError(id, -32000, `Tool execution failed: ${message}`)
  }
}

/**
 * Call GitHub API directly
 * This is a simplified implementation - in production, consider using Octokit
 */
async function callGitHubAPI(
  toolName: string,
  args: Record<string, unknown>,
  token: string
): Promise<unknown> {
  const baseUrl = "https://api.github.com"
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  const { owner, repo } = args as { owner: string; repo: string }

  switch (toolName) {
    case "list_issues": {
      const url = `${baseUrl}/repos/${owner}/${repo}/issues?state=${args.state || "open"}&per_page=${args.per_page || 30}&page=${args.page || 1}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "get_issue": {
      const url = `${baseUrl}/repos/${owner}/${repo}/issues/${args.issue_number}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "create_issue": {
      const url = `${baseUrl}/repos/${owner}/${repo}/issues`
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: args.title,
          body: args.body,
          labels: args.labels,
          assignees: args.assignees,
        }),
      })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "add_issue_comment": {
      const url = `${baseUrl}/repos/${owner}/${repo}/issues/${args.issue_number}/comments`
      const response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: args.body }),
      })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "list_pull_requests": {
      const url = `${baseUrl}/repos/${owner}/${repo}/pulls?state=${args.state || "open"}&per_page=${args.per_page || 30}&page=${args.page || 1}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "get_pull_request": {
      const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${args.pull_number}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "get_pull_request_diff": {
      const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${args.pull_number}`
      const response = await fetch(url, {
        headers: { ...headers, Accept: "application/vnd.github.diff" },
      })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return { diff: await response.text() }
    }

    case "search_repositories": {
      const url = `${baseUrl}/search/repositories?q=${encodeURIComponent(args.query as string)}&per_page=${args.per_page || 30}&page=${args.page || 1}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "search_code": {
      const url = `${baseUrl}/search/code?q=${encodeURIComponent(args.query as string)}&per_page=${args.per_page || 30}&page=${args.page || 1}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    case "get_file_contents": {
      let url = `${baseUrl}/repos/${owner}/${repo}/contents/${args.path}`
      if (args.ref) url += `?ref=${args.ref}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      const data = await response.json()
      // Decode base64 content if present
      if (data.content && data.encoding === "base64") {
        data.decoded_content = Buffer.from(data.content, "base64").toString("utf-8")
      }
      return data
    }

    case "list_branches": {
      const url = `${baseUrl}/repos/${owner}/${repo}/branches?per_page=${args.per_page || 30}&page=${args.page || 1}`
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`GitHub API error: ${response.statusText}`)
      return response.json()
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// =============================================================================
// SSE Handler
// =============================================================================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sandboxId: string }> }
): Promise<Response> {
  const { sandboxId } = await params

  // 1. Look up chat and validate
  const result = await getChatAndToken(sandboxId)
  if (!result) {
    return new Response("Chat not found or GitHub not connected", { status: 404 })
  }

  const { chat, githubToken } = result

  // 2. Check if MCP tools are enabled
  const mcpTools = parseMcpToolsConfig(chat.mcpTools)
  if (!mcpTools?.github) {
    return new Response("GitHub tools not enabled for this chat", { status: 403 })
  }

  // 3. Set up SSE stream
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  // Send SSE event
  const sendEvent = async (data: unknown) => {
    const json = JSON.stringify(data)
    await writer.write(encoder.encode(`data: ${json}\n\n`))
  }

  // Handle incoming messages (for bidirectional communication)
  // Note: SSE is primarily server->client, but we can handle initial setup

  // Send server info on connection
  sendEvent({
    jsonrpc: "2.0",
    method: "server/info",
    params: {
      name: "daytona-mcp-proxy",
      version: "1.0.0",
    },
  })

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

// =============================================================================
// POST Handler (for MCP JSON-RPC messages)
// =============================================================================

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sandboxId: string }> }
): Promise<Response> {
  const { sandboxId } = await params

  // 1. Look up chat and validate
  const result = await getChatAndToken(sandboxId)
  if (!result) {
    return Response.json(
      mcpError(0, -32001, "Chat not found or GitHub not connected"),
      { status: 404 }
    )
  }

  const { chat, githubToken } = result

  // 2. Check if MCP tools are enabled
  const mcpTools = parseMcpToolsConfig(chat.mcpTools)
  if (!mcpTools?.github) {
    return Response.json(
      mcpError(0, -32002, "GitHub tools not enabled for this chat"),
      { status: 403 }
    )
  }

  // 3. Parse MCP request
  let mcpRequest: McpRequest
  try {
    mcpRequest = await req.json()
  } catch {
    return Response.json(
      mcpError(0, -32700, "Parse error"),
      { status: 400 }
    )
  }

  // 4. Handle MCP methods
  let response: McpResponse

  switch (mcpRequest.method) {
    case "initialize":
      response = handleInitialize(mcpRequest.id)
      break

    case "tools/list":
      response = handleToolsList(mcpRequest.id, mcpTools)
      break

    case "tools/call": {
      const params = mcpRequest.params as {
        name: string
        arguments?: Record<string, unknown>
      }
      response = await handleToolsCall(
        mcpRequest.id,
        params.name,
        params.arguments || {},
        githubToken,
        chat.repo
      )
      break
    }

    case "notifications/initialized":
      // Client notification, no response needed
      return new Response(null, { status: 204 })

    default:
      response = mcpError(mcpRequest.id, -32601, `Method not found: ${mcpRequest.method}`)
  }

  // Log for audit
  console.log(
    JSON.stringify({
      type: "mcp_request",
      timestamp: new Date().toISOString(),
      userId: chat.userId,
      chatId: chat.id,
      sandboxId,
      method: mcpRequest.method,
      tool: (mcpRequest.params as { name?: string })?.name,
    })
  )

  return Response.json(response)
}
