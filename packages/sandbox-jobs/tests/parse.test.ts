/**
 * Pure unit tests for the parsing/status logic — no sandbox, instant.
 * These pin the subtle bits: status derivation from two signals, marker
 * splitting, complete-line-only cursor advancement, and byte accounting.
 */
import { describe, expect, it } from "vitest"
import { deriveStatus, parseRead } from "../src/jobs.js"

const read = (header: string, data: string, cursor = 0) =>
  parseRead(`${header}@@SBJ-DATA@@\n${data}`, cursor)

describe("deriveStatus", () => {
  it("clean exit: exit file present → exited with real code", () => {
    expect(deriveStatus("0", "")).toEqual({ state: "exited", exitCode: 0, alive: false })
    expect(deriveStatus("137", "")).toEqual({ state: "exited", exitCode: 137, alive: false })
  })

  it("running: no exit file, a live (non-zombie) process in the group", () => {
    expect(deriveStatus("", "S")).toEqual({ state: "running", exitCode: null, alive: true })
    expect(deriveStatus("", "RS")).toEqual({ state: "running", exitCode: null, alive: true })
  })

  it("crashed: no exit file and the group is gone", () => {
    expect(deriveStatus("", "")).toEqual({ state: "crashed", exitCode: null, alive: false })
  })

  it("crashed: no exit file and only zombies remain", () => {
    expect(deriveStatus("", "Z")).toEqual({ state: "crashed", exitCode: null, alive: false })
    expect(deriveStatus("", "ZZ")).toEqual({ state: "crashed", exitCode: null, alive: false })
  })

  it("exit file wins even if a zombie lingers", () => {
    expect(deriveStatus("0", "Z")).toEqual({ state: "exited", exitCode: 0, alive: false })
  })
})

describe("parseRead", () => {
  it("returns only complete lines and advances the cursor past them", () => {
    const r = read("EXIT:\nSTATE:S\n", "a\nb\nc")
    expect(r.raw).toBe("a\nb\n") // trailing partial "c" withheld
    expect(r.cursor).toBe(4) // 4 bytes committed ("a\nb\n")
    expect(r.bytesFetched).toBe(5) // whole tail "a\nb\nc" crossed the wire
    expect(r.status.state).toBe("running")
  })

  it("advances the cursor by the committed byte count from a non-zero start", () => {
    const r = read("EXIT:0\nSTATE:\n", "x\ny\n", 100)
    expect(r.raw).toBe("x\ny\n")
    expect(r.cursor).toBe(104)
    expect(r.status).toEqual({ state: "exited", exitCode: 0, alive: false })
  })

  it("withholds everything when there is no complete line yet", () => {
    const r = read("EXIT:\nSTATE:S\n", "partial-no-newline", 7)
    expect(r.raw).toBe("")
    expect(r.cursor).toBe(7) // unchanged — nothing committed
    expect(r.bytesFetched).toBe(18)
  })

  it("counts UTF-8 bytes, not characters, for the cursor", () => {
    const r = read("EXIT:\nSTATE:S\n", "é\n") // 'é' is 2 bytes + '\n'
    expect(r.raw).toBe("é\n")
    expect(r.cursor).toBe(3)
  })

  it("does not mistake log content that contains the marker word", () => {
    const r = read("EXIT:0\nSTATE:\n", "before @@SBJ-DATA@@ inline\n")
    expect(r.raw).toBe("before @@SBJ-DATA@@ inline\n")
    expect(r.status.state).toBe("exited")
  })
})
