import { describe, it, expect, vi, beforeEach } from "vitest"

const updateMany = vi.fn()
const chatUpdate = vi.fn()
const runQueuedTurnForChat = vi.fn()
const getChatWithAuth = vi.fn()
const messageFindFirst = vi.fn()
const resolveSendCredentials = vi.fn()
const getUserEndpoints = vi.fn()
const daytonaGet = vi.fn()

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    chat: { updateMany, update: chatUpdate },
    message: { findFirst: messageFindFirst },
  },
}))
vi.mock("@/lib/db/api-helpers", () => ({ getChatWithAuth }))
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

const { dispatchQueuedTurn, finishSetupRecord } = await import("./dispatch-setup-turn")

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
}

describe("dispatchQueuedTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DAYTONA_API_KEY = "key"
    chatUpdate.mockResolvedValue({})
    happyPath()
  })

  it("guards the transition on the current status, so only setting_up chats are claimed", async () => {
    updateMany.mockResolvedValue({ count: 1 })

    await dispatchQueuedTurn({
      chatId: "chat_1",
      userId: "user_1",
      setupRun: { ...RECORD, state: "exited", exitCode: 0 },
      logTail: "",
    })

    expect(updateMany).toHaveBeenCalledTimes(1)
    // The `where` IS the guard: without the status clause, a second observer
    // would also update a row and go on to run the turn.
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: "chat_1",
      status: "setting_up",
    })
    expect(updateMany.mock.calls[0][0].data.status).toBe("ready")
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

  it("passes the persisted message straight through as the agent prompt", async () => {
    updateMany.mockResolvedValue({ count: 1 })
    messageFindFirst.mockResolvedValue({
      id: "msg_user",
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
