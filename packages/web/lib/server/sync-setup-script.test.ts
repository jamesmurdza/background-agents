import { describe, it, expect, vi, beforeEach } from "vitest"
import { hashScript } from "@/lib/setup-script"

const { chatFindFirst, environmentUpdate, chatUpdate, readSetupScriptFromSandbox } = vi.hoisted(
  () => ({
    chatFindFirst: vi.fn(),
    environmentUpdate: vi.fn(),
    chatUpdate: vi.fn(),
    readSetupScriptFromSandbox: vi.fn(),
  })
)

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chat: { findFirst: chatFindFirst, update: chatUpdate },
    environment: { update: environmentUpdate },
  },
}))
vi.mock("@/lib/setup-script", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/setup-script")>()),
  readSetupScriptFromSandbox,
}))

const { syncSetupScript } = await import("./sync-setup-script")

const sandbox = {} as never
const WRITTEN = "npm install\n"

function chatRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "chat_1",
    environmentId: "env_1",
    setupRun: {
      handle: { jobId: "j" },
      environmentId: "env_1",
      writtenHash: hashScript(WRITTEN),
      startedAt: 0,
    },
    environment: { id: "env_1", setupScript: WRITTEN },
    ...overrides,
  }
}

describe("syncSetupScript", () => {
  beforeEach(() => {
    chatFindFirst.mockReset()
    environmentUpdate.mockReset()
    chatUpdate.mockReset()
    readSetupScriptFromSandbox.mockReset()
  })

  it("saves an agent edit and keeps the previous revision", async () => {
    chatFindFirst.mockResolvedValue(chatRow())
    readSetupScriptFromSandbox.mockResolvedValue("npm ci\n")

    const out = await syncSetupScript(sandbox, "chat_1")

    expect(out).toEqual({
      result: "saved",
      notice: { environmentId: "env_1", scriptHash: hashScript("npm ci\n"), updatedAt: expect.any(Number) },
    })
    expect(environmentUpdate).toHaveBeenCalledWith({
      where: { id: "env_1" },
      data: {
        setupScript: "npm ci\n",
        setupScriptPrevious: WRITTEN,
        setupScriptUpdatedBy: "agent",
      },
    })
  })

  it("stamps the scriptUpdateNotice marker onto the chat's setupRun", async () => {
    chatFindFirst.mockResolvedValue(chatRow())
    readSetupScriptFromSandbox.mockResolvedValue("npm ci\n")

    await syncSetupScript(sandbox, "chat_1")

    const setupRun = chatUpdate.mock.calls[0][0].data.setupRun
    expect(setupRun.scriptUpdateNotice).toEqual({
      environmentId: "env_1",
      scriptHash: hashScript("npm ci\n"),
      updatedAt: expect.any(Number),
    })
    // The existing job-tracking fields survive the merge.
    expect(setupRun.handle).toEqual({ jobId: "j" })
  })

  it("advances writtenHash so the next turn is a no-op", async () => {
    chatFindFirst.mockResolvedValue(chatRow())
    readSetupScriptFromSandbox.mockResolvedValue("npm ci\n")

    await syncSetupScript(sandbox, "chat_1")

    const written = chatUpdate.mock.calls[0][0].data.setupRun.writtenHash
    expect(written).toBe(hashScript("npm ci\n"))
  })

  it("does nothing when the agent did not touch the file", async () => {
    chatFindFirst.mockResolvedValue(chatRow())
    readSetupScriptFromSandbox.mockResolvedValue(WRITTEN)

    expect(await syncSetupScript(sandbox, "chat_1")).toEqual({
      result: "skipped",
      reason: "unchanged",
    })
    expect(environmentUpdate).not.toHaveBeenCalled()
  })

  it("refuses to clobber a user edit made during the turn", async () => {
    chatFindFirst.mockResolvedValue(
      chatRow({ environment: { id: "env_1", setupScript: "pnpm install\n" } })
    )
    readSetupScriptFromSandbox.mockResolvedValue("npm ci\n")

    expect(await syncSetupScript(sandbox, "chat_1")).toEqual({ result: "conflict" })
    expect(environmentUpdate).not.toHaveBeenCalled()
  })

  it("normalizes a null stored script to empty so a first edit is not a false conflict", async () => {
    chatFindFirst.mockResolvedValue(
      chatRow({
        setupRun: {
          handle: { jobId: "j" },
          environmentId: "env_1",
          writtenHash: hashScript(""),
          startedAt: 0,
        },
        environment: { id: "env_1", setupScript: null },
      })
    )
    readSetupScriptFromSandbox.mockResolvedValue("npm install\n")

    const out = await syncSetupScript(sandbox, "chat_1")
    expect(out.result).toBe("saved")
  })

  it("never writes environment variables or network settings", async () => {
    chatFindFirst.mockResolvedValue(chatRow())
    readSetupScriptFromSandbox.mockResolvedValue("npm ci\n")

    await syncSetupScript(sandbox, "chat_1")

    const data = environmentUpdate.mock.calls[0][0].data
    expect(Object.keys(data).sort()).toEqual([
      "setupScript",
      "setupScriptPrevious",
      "setupScriptUpdatedBy",
    ])
  })
})
