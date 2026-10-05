import { describe, expect, it, vi } from "vitest"
import { DaytonaNotFoundError, DaytonaTimeoutError, type Daytona, type Sandbox } from "@daytonaio/sdk"
import { classifyResponse, getSandboxOrExpired, passiveReadGate } from "./sandbox-lifecycle"

describe("sandbox lifecycle reads", () => {
  it("returns the existing sandbox without changing its state", async () => {
    const sandbox = { id: "qa", state: "stopped" } as Sandbox
    const daytona = { get: vi.fn().mockResolvedValue(sandbox) } as unknown as Daytona
    expect(await getSandboxOrExpired(daytona, "qa")).toBe(sandbox)
  })

  it("reports an expired sandbox only for a confirmed not-found response", async () => {
    const daytona = { get: vi.fn().mockRejectedValue(new DaytonaNotFoundError("Not found", 404)) } as unknown as Daytona
    const result = await getSandboxOrExpired(daytona, "qa") as Response
    expect(result.status).toBe(410)
    expect(await result.json()).toEqual({ error: "SANDBOX_NOT_FOUND" })
  })

  it.each([new DaytonaTimeoutError("Timed out"), new Error("Connection reset")])(
    "does not turn a transport failure into a permanent expired state: %s", async error => {
      const daytona = { get: vi.fn().mockRejectedValue(error) } as unknown as Daytona
      await expect(getSandboxOrExpired(daytona, "qa")).rejects.toBe(error)
    }
  )

  it("leaves passive reads stopped and permits explicit resume", () => {
    const sandbox = { state: "stopped" } as Sandbox
    expect(passiveReadGate(sandbox, false)?.status).toBe(409)
    expect(passiveReadGate(sandbox, true)).toBeNull()
  })

  it("keeps retryable HTTP failures distinct from stopped or expired", () => {
    expect(classifyResponse(new Response(null, { status: 503 }))).toEqual({ kind: "error" })
    expect(classifyResponse(new Response(null, { status: 410 }))).toEqual({ kind: "state", state: "expired" })
  })
})
