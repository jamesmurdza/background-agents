import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"

const launch = vi.hoisted(() => ({ start: vi.fn(), nextId: "", upload: vi.fn(async (): Promise<string[]> => []) }))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class {} }))
vi.mock("@/lib/db/api-helpers", async (original) => ({
  ...await original<typeof import("@/lib/db/api-helpers")>(),
  decryptUserCredentials: () => ({}),
}))
vi.mock("@/lib/db/activity-log", () => ({ logActivityAsync: vi.fn() }))
vi.mock("@/lib/server/shared-pool", () => ({ buildUsageMeta: () => ({}) }))
vi.mock("@/lib/server/custom-endpoints", () => ({ getUserEndpoints: async () => [] }))
vi.mock("@/lib/server/turn-secrets", async (original) => ({
  ...await original<typeof import("@/lib/server/turn-secrets")>(),
  mountTurnSecrets: async () => {},
  releaseTurnSecrets: async () => {},
}))
vi.mock("@/lib/mcp/agent-servers", () => ({ loadMcpConnections: async () => [] }))
vi.mock("@/lib/sandbox", () => ({ deleteSandboxQuietly: vi.fn(), discoverSkillsForRepo: async () => [], uploadFilesToSandbox: launch.upload }))
vi.mock("./resolve-credentials", () => ({ resolveSendCredentials: async () => ({ credentials: {}, githubToken: "", useSharedClaude: false }) }))
vi.mock("./ensure-sandbox", () => ({ ensureSandboxForChat: async () => ({ sandbox: {}, sandboxId: "isolated-test", createdSandbox: false, branchRestored: false }) }))
vi.mock("./pre-run-pull", () => ({ runPreRunPull: async () => ({ pullConflictNote: "" }) }))
vi.mock("./history", () => ({ buildAgentHistory: async () => ({ isAgentSwitch: false }) }))
vi.mock("./agent-env", () => ({ buildAgentEnv: async () => ({}) }))
vi.mock("@/lib/agent-session", () => ({ createBackgroundAgentSession: async () => ({ backgroundSessionId: launch.nextId, start: launch.start }) }))

import { prisma } from "@/lib/db/prisma"
import { sendChatTurn } from "./send-turn"

const payload = (message: string) => ({ message, agent: "eliza", model: "eliza-classic-1.0", userMessageId: randomUUID(), assistantMessageId: randomUUID() })
let userId = ""
beforeAll(async () => {
  if (!process.env.DATABASE_URL) return
  userId = (await prisma.user.create({ data: { email: `launch-recovery-${randomUUID()}@example.test` } })).id
})
afterAll(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } })
  await prisma.$disconnect()
})

it.skipIf(!process.env.DATABASE_URL)("retains the saved turn through an uncertain launch and rejects a second execution", async () => {
  const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready", sandboxId: "isolated-test" } })
  const first = payload("First")
  launch.nextId = randomUUID()
  const reason = "Could not start sandbox job: Launch response lost after execution may have started"
  launch.start.mockRejectedValueOnce(new Error(reason))
  const logged = vi.spyOn(console, "error").mockImplementation(() => {})
  try {
    const response = await sendChatTurn({ userId, chatId: chat.id, payload: first, files: [] })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: reason })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining(reason))
  } finally {
    logged.mockRestore()
  }
  const saved = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })
  expect(saved).toMatchObject({ status: "running", backgroundSessionId: launch.nextId, activeAssistantMessageId: first.assistantMessageId, sandboxId: "isolated-test" })
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(2)
  expect(await prisma.message.findUniqueOrThrow({ where: { id: first.assistantMessageId } })).toMatchObject({
    metadata: { launchError: reason },
  })
  expect((await sendChatTurn({ userId, chatId: chat.id, payload: payload("Second"), files: [] })).status).toBe(409)
  expect(launch.start).toHaveBeenCalledTimes(1)
})

it.skipIf(!process.env.DATABASE_URL)("runs a file-only message on its uploaded files, and not at all when the upload fails", async () => {
  launch.start.mockClear()
  const chat = await prisma.chat.create({ data: { userId, repo: "__new__", status: "ready", sandboxId: "isolated-test" } })
  const file = new File(["png"], "shot.png", { type: "image/png" })
  launch.upload.mockRejectedValueOnce(new Error("upload failed"))
  vi.spyOn(console, "error").mockImplementation(() => {})
  expect((await sendChatTurn({ userId, chatId: chat.id, payload: payload(""), files: [file] })).status).toBe(500)
  expect(launch.start).not.toHaveBeenCalled()
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(0)
  expect((await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })).status).toBe("ready")

  launch.nextId = randomUUID()
  launch.upload.mockResolvedValueOnce(["/home/daytona/uploads/shot.png"])
  const sent = payload("")
  expect((await sendChatTurn({ userId, chatId: chat.id, payload: sent, files: [file] })).status).toBe(200)
  expect(launch.start).toHaveBeenCalledWith("Uploaded files:\n- /home/daytona/uploads/shot.png", undefined)
  expect(await prisma.message.findUniqueOrThrow({ where: { id: sent.userMessageId } })).toMatchObject({ content: "", uploadedFiles: ["/home/daytona/uploads/shot.png"] })
})
