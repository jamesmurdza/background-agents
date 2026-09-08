import { describe, it, expect, vi, beforeEach } from "vitest"

const updateMany = vi.fn()
const chatUpdate = vi.fn()
const runQueuedTurnForChat = vi.fn()
const getChatWithAuth = vi.fn()
const messageFindFirst = vi.fn()
const resolveSendCredentials = vi.fn()
const getUserEndpoints = vi.fn()
const daytonaGet = vi.fn()
const ensureSandboxStarted = vi.fn()

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chat: { updateMany, update: chatUpdate },
    message: { findFirst: messageFindFirst },
  },
}))
vi.mock("@/lib/db/api-helpers", () => ({ getChatWithAuth }))
vi.mock("@/lib/sandbox", () => ({ ensureSandboxStarted }))
vi.mock("@prisma/client", () => ({ Prisma: { DbNull: Symbol("DbNull") } }))
vi.mock("@/lib/server/custom-endpoints", () => ({ getUserEndpoints }))
vi.mock("@/app/api/chats/[chatId]/messages/_lib/resolve-credentials", () => ({
  resolveSendCredentials,
}))
vi.mock("./run-queued-turn", () => ({ runQueuedTurnForChat }))
vi.mock("@daytonaio/sdk", () => ({
  Daytona: class {
    get = daytonaGet
  },
}))

const { Prisma } = await import("@prisma/client")
const { dispatchQueuedTurn, finishSetupRecord, DISPATCH_CLAIM_TTL_MS } = await import(
  "./dispatch-setup-turn"
)

const RECORD = {
  handle: { jobId: "job_1" } as never,
  environmentId: "env_1",
  writtenHash: "abc",
  startedAt: 1,
}

function happyPath() {
  getChatWithAuth.mockResolvedValue({
    id: "chat_1",
    agent: "claude-code",
    model: "sonnet",
    sandboxId: "sbx_1",
    previewUrlPattern: null,
    planModeEnabled: false,
  })
  messageFindFirst.mockResolvedValue({
    id: "msg_user",
    role: "user",
    content: "fix the build",
    agent: "claude-code",
    model: "sonnet",
    uploadedFiles: null,
  })
  resolveSendCredentials.mockResolvedValue({
    credentials: {},
    githubToken: null,
    useSharedClaude: false,
  })
  getUserEndpoints.mockResolvedValue([])
  daytonaGet.mockResolvedValue({})
  runQueuedTurnForChat.mockResolvedValue({ backgroundSessionId: "bg_1" })
  ensureSandboxStarted.mockResolvedValue(undefined)
}

describe("dispatchQueuedTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DAYTONA_API_KEY = "key"
    chatUpdate.mockResolvedValue({})
    happyPath()
  })

  it("guards the claim on the current status and on any live claim", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    const before = Date.now()

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(updateMany).toHaveBeenCalledTimes(1)
    const where = updateMany.mock.calls[0][0].where
    // The `where` IS the guard. Without the status clause a second observer
    // would also update a row and run the turn again; without the OR clause a
    // second observer would steal a dispatch that is still in flight.
    expect(where.id).toBe("chat_1")
    expect(where.status).toBe("setting_up")
    expect(where.OR[0]).toEqual({
      setupRun: { path: ["claimedAt"], equals: Prisma.DbNull },
    })
    expect(where.OR[1].setupRun.path).toEqual(["claimedAt"])
    expect(where.OR[1].setupRun.lt).toBeLessThanOrEqual(before - DISPATCH_CLAIM_TTL_MS)
  })

  it("leaves the chat in setting_up while it dispatches, so a killed dispatch is recoverable", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    const data = updateMany.mock.calls[0][0].data
    // A chat parked at `ready` mid-startup is invisible to every recovery path.
    expect(data.status).toBeUndefined()
    expect(data.setupRun.claimedAt).toEqual(expect.any(Number))
  })

  it("starts the sandbox before the turn, because a held turn skipped ensureSandboxForChat", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(ensureSandboxStarted).toHaveBeenCalledTimes(1)
    expect(runQueuedTurnForChat).toHaveBeenCalledTimes(1)
  })

  it("runs the turn exactly once for the caller that changed a row", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    const dispatched = await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(dispatched).toBe(true)
    expect(runQueuedTurnForChat).toHaveBeenCalledTimes(1)
  })

  it("does not run the turn when another observer already claimed the exit", async () => {
    updateMany.mockResolvedValue({ count: 0 })

    const dispatched = await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(dispatched).toBe(false)
    expect(runQueuedTurnForChat).not.toHaveBeenCalled()
  })

  it("two observers of the same exit produce exactly one turn", async () => {
    // First caller updates the row; the second finds nothing left to update.
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })

    const args = {
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited" as const, exitCode: 0 },
      logTail: "",
    }
    const results = await Promise.all([
      dispatchQueuedTurn(args),
      dispatchQueuedTurn(args),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(runQueuedTurnForChat).toHaveBeenCalledTimes(1)
  })

  it("passes no failure note when the script exited 0", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "all good",
    })

    expect(runQueuedTurnForChat.mock.calls[0][0].setupFailureNote).toBeNull()
  })

  it("hands the agent a failure note with the log tail, and still runs the turn", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 1 },
      logTail: "npm ERR! missing script",
    })

    const note = runQueuedTurnForChat.mock.calls[0][0].setupFailureNote as string
    expect(note).toContain("exit code 1")
    expect(note).toContain("npm ERR! missing script")
    expect(runQueuedTurnForChat).toHaveBeenCalledTimes(1)
  })

  it("treats a crashed job as a failure", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "crashed", exitCode: null },
      logTail: "",
    })

    expect(runQueuedTurnForChat.mock.calls[0][0].setupFailureNote).toBeTruthy()
  })

  it("marks the chat errored when the claimed turn fails to start", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    runQueuedTurnForChat.mockRejectedValue(new Error("sandbox gone"))

    const dispatched = await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    // Still true: this caller owned the exit, it just could not finish.
    expect(dispatched).toBe(true)
    expect(chatUpdate).toHaveBeenCalledWith({
      where: { id: "chat_1" },
      data: { status: "error" },
    })
  })

  it("fails the turn rather than leaking a Response when credentials are refused", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    resolveSendCredentials.mockResolvedValue(
      Response.json({ error: "DAILY_LIMIT_EXCEEDED" }, { status: 429 })
    )

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(runQueuedTurnForChat).not.toHaveBeenCalled()
    expect(chatUpdate).toHaveBeenCalledWith({
      where: { id: "chat_1" },
      data: { status: "error" },
    })
  })

  it("refuses to re-dispatch a user message that already has an answer", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    // The newest user/assistant row is an assistant reply, so the last user
    // message was already answered: this is a recreated sandbox whose
    // `setting_up` write landed but whose queued message never did.
    messageFindFirst.mockResolvedValue({
      id: "msg_assistant",
      role: "assistant",
      content: "already answered",
      agent: "claude-code",
      model: "sonnet",
      uploadedFiles: null,
    })

    const dispatched = await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(runQueuedTurnForChat).not.toHaveBeenCalled()
    // Owned the exit, and unsticks the chat rather than leaving it 409-busy.
    // Ready rather than error: nothing is broken, there is just nothing to run.
    expect(dispatched).toBe(true)
    expect(chatUpdate).toHaveBeenCalledWith({
      where: { id: "chat_1" },
      data: { status: "ready" },
    })
  })

  it("passes the persisted message straight through as the agent prompt", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    messageFindFirst.mockResolvedValue({
      id: "msg_user",
      role: "user",
      content: "fix it\n\n---\nUploaded files:\n- /a.png",
      agent: "claude-code",
      model: "sonnet",
      uploadedFiles: ["/a.png"],
    })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    const call = runQueuedTurnForChat.mock.calls[0][0]
    expect(call.agentPrompt).toBe("fix it\n\n---\nUploaded files:\n- /a.png")
    expect(call.uploadedFilePaths).toEqual(["/a.png"])
    expect(call.payload.userMessageId).toBe("msg_user")
  })
})

describe("finishSetupRecord", () => {
  it("keeps a clean exit as exited", () => {
    const r = finishSetupRecord(RECORD, { state: "exited", exitCode: 0 })
    expect(r.state).toBe("exited")
    expect(r.exitCode).toBe(0)
    expect(typeof r.finishedAt).toBe("number")
  })

  it("maps anything else to crashed", () => {
    expect(finishSetupRecord(RECORD, { state: "crashed", exitCode: null }).state).toBe(
      "crashed"
    )
  })
})
