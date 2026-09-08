import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

vi.mock("@/lib/db/api-helpers", () => ({
  requireAuth: vi.fn(async () => ({ userId: "u1" })),
  isAuthError: vi.fn(() => false),
  notFound: vi.fn((message: string) => Response.json({ error: message }, { status: 404 })),
  forbidden: vi.fn((message: string) => Response.json({ error: message }, { status: 403 })),
  internalError: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  ),
  getGitHubToken: vi.fn(async () => "gh-token"),
}))

const getOwnedEnvironment = vi.fn()
vi.mock("@/lib/environments", () => ({
  getOwnedEnvironment: (...args: unknown[]) => getOwnedEnvironment(...args),
  toResolvedEnvironment: (row: unknown) => row,
}))

const createSandboxForChat = vi.fn()
vi.mock("@/lib/sandbox", () => ({
  createSandboxForChat: (...args: unknown[]) => createSandboxForChat(...args),
}))

const getRepo = vi.fn()
vi.mock("@background-agents/common", () => ({
  getRepo: (...args: unknown[]) => getRepo(...args),
}))

vi.mock("@background-agents/sandbox-jobs", () => ({
  createSandboxJobs: vi.fn(() => ({ read: vi.fn() })),
}))

vi.mock("@daytonaio/sdk", () => ({
  Daytona: vi.fn().mockImplementation(() => ({})),
}))

import { GET } from "./route"
import { getGitHubToken } from "@/lib/db/api-helpers"

function makeRequest(headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return new Request("http://localhost/api/environments/env_1/run-setup", { headers })
}

function params(id = "env_1") {
  return { params: Promise.resolve({ id }) }
}

const resolvedEnvironment = {
  id: "env_1",
  name: "Default",
  repo: "acme/app",
  isDefault: true,
  networkMode: "full" as const,
  allowedDomains: [],
  variables: {},
  setupScript: "npm install\n",
}

function makeCreatedSandbox() {
  return {
    sandbox: { delete: vi.fn().mockResolvedValue(undefined) },
    sandboxId: "sbx-1",
    branch: "setup-check/1",
    previewUrlPattern: undefined,
    repoName: "project",
    setupRun: {
      handle: { jobId: "job-1", dir: "/d", outputFile: "/d/out", exitFile: "/d/exit", pgid: 1, cgroup: "cg" },
      environmentId: "env_1",
      writtenHash: "hash",
      startedAt: Date.now(),
      state: "running" as const,
    },
  }
}

beforeEach(() => {
  getOwnedEnvironment.mockReset()
  createSandboxForChat.mockReset()
  getRepo.mockReset()
  vi.mocked(getGitHubToken).mockClear()
  process.env.DAYTONA_API_KEY = "test-key"
})

describe("GET /api/environments/[id]/run-setup", () => {
  it("rejects a cross-site request before touching auth or the database", async () => {
    const res = await GET(makeRequest({ "sec-fetch-site": "cross-site" }), params())

    expect(res.status).toBe(403)
    expect(getOwnedEnvironment).not.toHaveBeenCalled()
    expect(createSandboxForChat).not.toHaveBeenCalled()
  })

  it("rejects a request with no Sec-Fetch-Site header at all", async () => {
    const res = await GET(makeRequest({}), params())
    expect(res.status).toBe(403)
  })

  it("404s when the environment has no saved setup script", async () => {
    getOwnedEnvironment.mockResolvedValue({ ...resolvedEnvironment, setupScript: "  " })

    const res = await GET(makeRequest(), params())

    expect(res.status).toBe(404)
    expect(createSandboxForChat).not.toHaveBeenCalled()
  })

  it("resolves the repo's real default branch instead of hardcoding main", async () => {
    getOwnedEnvironment.mockResolvedValue(resolvedEnvironment)
    getRepo.mockResolvedValue({ default_branch: "develop" })
    createSandboxForChat.mockResolvedValue(makeCreatedSandbox())

    await GET(makeRequest(), params())

    expect(getRepo).toHaveBeenCalledWith("gh-token", "acme", "app")
    expect(createSandboxForChat).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: "develop" })
    )
  })

  it("falls back to main when the default-branch lookup fails", async () => {
    getOwnedEnvironment.mockResolvedValue(resolvedEnvironment)
    getRepo.mockRejectedValue(new Error("network blip"))
    createSandboxForChat.mockResolvedValue(makeCreatedSandbox())

    await GET(makeRequest(), params())

    expect(createSandboxForChat).toHaveBeenCalledWith(expect.objectContaining({ baseBranch: "main" }))
  })

  it("caps the validation run's script timeout and the sandbox's auto-delete window", async () => {
    getOwnedEnvironment.mockResolvedValue(resolvedEnvironment)
    getRepo.mockResolvedValue({ default_branch: "main" })
    createSandboxForChat.mockResolvedValue(makeCreatedSandbox())

    await GET(makeRequest(), params())

    expect(createSandboxForChat).toHaveBeenCalledWith(
      expect.objectContaining({
        setupScriptTimeoutSeconds: 180,
        autoDeleteIntervalMinutes: 15,
      })
    )
  })

  it("streams SSE headers on success", async () => {
    getOwnedEnvironment.mockResolvedValue(resolvedEnvironment)
    getRepo.mockResolvedValue({ default_branch: "main" })
    createSandboxForChat.mockResolvedValue(makeCreatedSandbox())

    const res = await GET(makeRequest(), params())

    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/event-stream")
  })
})
