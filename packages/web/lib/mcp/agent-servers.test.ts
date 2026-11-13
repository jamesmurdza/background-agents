import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  update: vi.fn(),
  getGitHubToken: vi.fn(),
  signGmailToken: vi.fn(),
  getVendorAccessToken: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    mcpServerConnection: {
      findMany: vi.fn(async () => mocks.rows),
      update: mocks.update,
    },
  },
}))

vi.mock("@background-agents/mcp", async (original) => ({
  ...(await original<typeof import("@background-agents/mcp")>()),
  createGitHubMcpProvider: () => ({ getToken: mocks.getGitHubToken }),
}))

vi.mock("./gmail", () => ({
  getGmailProvider: () => ({ signConnectionToken: mocks.signGmailToken }),
  getGmailMcpUrl: () => "https://app.test/api/mcp/gmail",
}))

vi.mock("./vendors", () => ({ getVendorAccessToken: mocks.getVendorAccessToken }))

import { loadMcpConnections } from "./agent-servers"

const owner = { kind: "chat", id: "chat-1" } as const

/** A connection row on a chat whose user has these credentials. */
function row(qualifiedName: string, credentials: { provider: string; installationId?: string }[]) {
  return {
    id: `row-${qualifiedName}`,
    qualifiedName,
    mcpUrl: "https://stored.example/mcp",
    chat: {
      user: {
        id: "user-1",
        mcpCredentials: credentials.map((c) => ({ provider: c.provider, installationId: c.installationId ?? null })),
      },
    },
    scheduledJob: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.stubEnv("GITHUB_APP_ID", "1")
  vi.stubEnv("GITHUB_APP_SLUG", "app")
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "key")
})

describe("loadMcpConnections", () => {
  it("mints a GitHub token for the installation in the user's github credential", async () => {
    mocks.rows = [row("github/github", [{ provider: "github", installationId: "42" }])]
    mocks.getGitHubToken.mockResolvedValue("gh-token")

    await expect(loadMcpConnections(owner)).resolves.toEqual([
      { name: "github-github", url: "https://stored.example/mcp", bearerToken: "gh-token" },
    ])
    expect(mocks.getGitHubToken).toHaveBeenCalledWith("42")
  })

  it("marks the GitHub row as failing when the user has no installation", async () => {
    mocks.rows = [row("github/github", [{ provider: "gmail" }])]

    await expect(loadMcpConnections(owner)).resolves.toEqual([])
    expect(mocks.getGitHubToken).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "row-github/github" },
      data: { status: "error", lastError: "GitHub App not installed for this user" },
    })
  })

  it("gives Gmail a connection token only when the user linked Google", async () => {
    mocks.signGmailToken.mockResolvedValue("gmail-token")
    mocks.rows = [row("google/gmail", [{ provider: "gmail" }])]
    await expect(loadMcpConnections(owner)).resolves.toEqual([
      { name: "google-gmail", url: "https://app.test/api/mcp/gmail", bearerToken: "gmail-token" },
    ])

    mocks.rows = [row("google/gmail", [])]
    await expect(loadMcpConnections(owner)).resolves.toEqual([])
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "row-google/gmail" },
      data: { status: "error", lastError: "Google account not connected for this user" },
    })
  })

  it("treats existing Paddle rows as a vendor login", async () => {
    mocks.rows = [row("paddle/paddle", [])]
    mocks.getVendorAccessToken.mockResolvedValue("paddle-token")

    await expect(loadMcpConnections(owner)).resolves.toEqual([
      { name: "paddle-paddle", url: "https://mcp.paddle.com/mcp", bearerToken: "paddle-token" },
    ])
    expect(mocks.getVendorAccessToken).toHaveBeenCalledWith("user-1", expect.objectContaining({ slug: "paddle" }))
  })
})
