import { afterAll, beforeAll, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"

const launch = vi.hoisted(() => ({ start: vi.fn(), nextId: "" }))
vi.mock("@daytonaio/sdk", () => ({ Daytona: class {} }))
vi.mock("@/lib/db/api-helpers", async (original) => ({
  ...await original<typeof import("@/lib/db/api-helpers")>(),
  decryptUserCredentials: () => ({}),
}))
vi.mock("@/lib/db/activity-log", () => ({ logActivityAsync: vi.fn() }))
vi.mock("@/lib/server/shared-pool", () => ({ buildUsageMeta: () => ({}) }))
vi.mock("@/lib/server/custom-endpoints", () => ({ getUserEndpoints: async () => [] }))
vi.mock("@/lib/mcp/agent-servers", () => ({ loadMcpConnections: async () => [] }))
vi.mock("@/lib/sandbox", () => ({ deleteSandboxQuietly: vi.fn(), discoverSkillsForRepo: async () => [], uploadFilesToSandbox: async () => [] }))
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
  launch.start.mockRejectedValueOnce(new Error("launch response lost after execution may have started"))
  expect((await sendChatTurn({ userId, chatId: chat.id, payload: first, files: [] })).status).toBe(500)
  const saved = await prisma.chat.findUniqueOrThrow({ where: { id: chat.id } })
  expect(saved).toMatchObject({ status: "running", backgroundSessionId: launch.nextId, activeAssistantMessageId: first.assistantMessageId, sandboxId: "isolated-test" })
  expect(await prisma.message.count({ where: { chatId: chat.id } })).toBe(2)
  expect((await sendChatTurn({ userId, chatId: chat.id, payload: payload("Second"), files: [] })).status).toBe(409)
  expect(launch.start).toHaveBeenCalledTimes(1)
})
