/**
 * Unit tests for installing uploaded skill zips.
 *
 * No real sandbox: sandbox.process.executeCommand is mocked by command
 * pattern, like discover.test.ts.
 */
import { describe, it, expect, vi } from "vitest"
import { installSkillArchive, installSkills } from "../../src/sandbox/install"
import type { Sandbox } from "@daytonaio/sdk"

function makeSandbox(skillName: string, installExit = 0) {
  const executeCommand = vi.fn(async (cmd: string) => {
    if (cmd.includes("unzip")) return { exitCode: 0, result: "files/SKILL.md" }
    if (cmd.startsWith("cat ")) return { exitCode: 0, result: `---\nname: ${skillName}\ndescription: Test skill.\n---\n` }
    if (cmd.includes("skills add")) return { exitCode: installExit, result: installExit ? "Error: failed" : "Done" }
    return { exitCode: 0, result: "" }
  })
  return { sandbox: { process: { executeCommand }, fs: { uploadFile: vi.fn() } } as unknown as Sandbox, executeCommand }
}

describe("uploaded skills", () => {
  it("rejects skill names that aren't safe to use in a command", async () => {
    const { sandbox, executeCommand } = makeSandbox("x; rm -rf ~")
    const result = await installSkillArchive(sandbox, "/home/daytona/project", new Uint8Array([1]))

    expect(result.success).toBe(false)
    expect(executeCommand.mock.calls.some(([cmd]) => cmd.includes("skills add"))).toBe(false)
  })

  it("keeps an uploaded skill's record when its install fails", async () => {
    const { sandbox } = makeSandbox("pr-style", 1)
    const onRemove = vi.fn()
    const result = await installSkills(sandbox, "/home/daytona/project", [
      { id: "skill-1", fullHandle: "upload/pr-style", archive: new Uint8Array([1]) },
    ], onRemove)

    expect(result.installed).toBe(0)
    expect(onRemove).not.toHaveBeenCalled()
    expect(result.batchResults).toEqual([
      { id: "skill-1", fullHandle: "upload/pr-style", status: "failed", error: expect.any(String) },
    ])
  })
})

describe("installSkills onRemove semantics", () => {
  function makeListSandbox(opts: { listResult: "found" | "not-found" | "list-fails"; installExit: number }) {
    const executeCommand = vi.fn(async (cmd: string) => {
      if (cmd.includes("--list")) {
        if (opts.listResult === "list-fails") return { exitCode: 1, result: "boom" }
        if (opts.listResult === "not-found") return { exitCode: 0, result: "Found 1 skill(s):\n  - other-skill" }
        return { exitCode: 0, result: "Found 1 skill(s):\n  - real-skill" }
      }
      if (cmd.includes("skills add")) {
        return { exitCode: opts.installExit, result: opts.installExit ? "Error: failed" : "Done" }
      }
      return { exitCode: 0, result: "" }
    })
    return { sandbox: { process: { executeCommand } } as unknown as Sandbox, executeCommand }
  }

  it("calls onRemove when the skill is confirmed absent from the available list", async () => {
    const { sandbox } = makeListSandbox({ listResult: "not-found", installExit: 0 })
    const onRemove = vi.fn(async () => {})
    const result = await installSkills(sandbox, "/home/daytona/project", [
      { id: "skill-1", fullHandle: "owner/repo/real-skill" },
    ], onRemove)

    expect(onRemove).toHaveBeenCalledWith("skill-1")
    expect(result.batchResults[0].status).toBe("not-found")
  })

  it("does NOT call onRemove when a found skill's install exec fails transiently", async () => {
    const { sandbox } = makeListSandbox({ listResult: "found", installExit: 1 })
    const onRemove = vi.fn()
    const result = await installSkills(sandbox, "/home/daytona/project", [
      { id: "skill-1", fullHandle: "owner/repo/real-skill" },
    ], onRemove)

    expect(onRemove).not.toHaveBeenCalled()
    expect(result.batchResults[0].status).toBe("failed")
  })

  it("does NOT call onRemove when the --list check itself is inconclusive and install fails", async () => {
    const { sandbox } = makeListSandbox({ listResult: "list-fails", installExit: 1 })
    const onRemove = vi.fn()
    const result = await installSkills(sandbox, "/home/daytona/project", [
      { id: "skill-1", fullHandle: "owner/repo/real-skill" },
    ], onRemove)

    expect(onRemove).not.toHaveBeenCalled()
    expect(result.batchResults[0].status).toBe("failed")
  })
})
