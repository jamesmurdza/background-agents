import { describe, it, expect } from "vitest"
import { appendSetupLog } from "./setup-log"

describe("appendSetupLog", () => {
  it("appends chunks within one connection", () => {
    let log = appendSetupLog("", "installing", true)
    log = appendSetupLog(log, " deps", false)
    expect(log).toBe("installing deps")
  })

  it("replaces the buffer with the replay after a reconnect, instead of duplicating it", () => {
    // First connection saw part of the log, then the route's maxDuration cut
    // it off. The route restarts its read at byte 0, so the reconnect's first
    // chunk contains everything already shown.
    const beforeDrop = appendSetupLog("", "line 1\nline 2\n", true)
    const replay = appendSetupLog(beforeDrop, "line 1\nline 2\nline 3\n", true)

    expect(replay).toBe("line 1\nline 2\nline 3\n")
    expect(replay.match(/line 1/g)).toHaveLength(1)
  })

  it("keeps the old log visible until the replay actually arrives", () => {
    // Nothing is cleared at connect time, so a reconnect that never delivers
    // a chunk leaves the user reading what they had.
    expect(appendSetupLog("line 1\n", "", false)).toBe("line 1\n")
  })
})
