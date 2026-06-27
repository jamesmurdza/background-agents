/**
 * Unit tests for discoverInstalledSkills.
 *
 * These are pure unit tests — no real sandbox. We mock
 * sandbox.process.executeCommand to simulate the filesystem responses.
 */
import { describe, it, expect, vi } from "vitest"
import { discoverInstalledSkills } from "../../src/sandbox/discover"
import type { Sandbox } from "@daytonaio/sdk"

// Helper: build a minimal sandbox mock
function makeSandbox(responses: Record<string, string>): Sandbox {
  return {
    process: {
      executeCommand: vi.fn(async (cmd: string) => {
        for (const [pattern, result] of Object.entries(responses)) {
          if (cmd.includes(pattern)) {
            return { exitCode: 0, result }
          }
        }
        return { exitCode: 0, result: "" }
      }),
    },
  } as unknown as Sandbox
}

const SKILL_MD_VALID = `---
name: react-best-practices
description: Enforces React patterns and hooks conventions. Use when writing React components.
license: MIT
---
# React Best Practices

Follow these rules when writing React code.
`

const SKILL_MD_NO_DESCRIPTION = `---
name: broken-skill
---
# No description here
`

const SKILL_MD_NO_FRONTMATTER = `# Just plain markdown

No frontmatter at all.
`

const SKILL_MD_QUOTED_VALUES = `---
name: code-review
description: "Reviews code for bugs and style. Use when asked to review a PR."
---
Body here.
`

describe("discoverInstalledSkills", () => {
  it("returns empty array when .agents/skills does not exist", async () => {
    const sandbox = {
      process: {
        executeCommand: vi.fn(async () => {
          throw new Error("No such file or directory")
        }),
      },
    } as unknown as Sandbox

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toEqual([])
  })

  it("returns empty array when find returns no SKILL.md files", async () => {
    const sandbox = makeSandbox({ "find": "" })
    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toEqual([])
  })

  it("parses a valid SKILL.md and returns name, description, location", async () => {
    const sandbox = makeSandbox({
      "find": "/repo/.agents/skills/react-best-practices/SKILL.md",
      "SKILL.md": SKILL_MD_VALID,
    })

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: "react-best-practices",
      description: "Enforces React patterns and hooks conventions. Use when writing React components.",
      location: "/repo/.agents/skills/react-best-practices/SKILL.md",
    })
  })

  it("strips quotes from frontmatter values", async () => {
    const sandbox = makeSandbox({
      "find": "/repo/.agents/skills/code-review/SKILL.md",
      "SKILL.md": SKILL_MD_QUOTED_VALUES,
    })

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result[0]?.description).toBe("Reviews code for bugs and style. Use when asked to review a PR.")
  })

  it("skips a skill with missing description", async () => {
    const sandbox = makeSandbox({
      "find": "/repo/.agents/skills/broken-skill/SKILL.md",
      "SKILL.md": SKILL_MD_NO_DESCRIPTION,
    })

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toHaveLength(0)
  })

  it("skips a skill with no frontmatter at all", async () => {
    const sandbox = makeSandbox({
      "find": "/repo/.agents/skills/plain-skill/SKILL.md",
      "SKILL.md": SKILL_MD_NO_FRONTMATTER,
    })

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toHaveLength(0)
  })

  it("uses directory name as fallback when frontmatter name is empty", async () => {
    const noNameSkill = `---
description: Does something useful.
---
Body.
`
    const sandbox = makeSandbox({
      "find": "/repo/.agents/skills/my-skill/SKILL.md",
      "SKILL.md": noNameSkill,
    })

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("my-skill")
  })

  it("handles multiple skills and skips invalid ones", async () => {
    const sandbox = {
      process: {
        executeCommand: vi.fn(async (cmd: string) => {
          if (cmd.includes("find")) {
            return {
              exitCode: 0,
              result: [
                "/repo/.agents/skills/react-best-practices/SKILL.md",
                "/repo/.agents/skills/broken-skill/SKILL.md",
              ].join("\n"),
            }
          }
          if (cmd.includes("react-best-practices")) {
            return { exitCode: 0, result: SKILL_MD_VALID }
          }
          if (cmd.includes("broken-skill")) {
            return { exitCode: 0, result: SKILL_MD_NO_DESCRIPTION }
          }
          return { exitCode: 0, result: "" }
        }),
      },
    } as unknown as Sandbox

    const result = await discoverInstalledSkills(sandbox, "/repo")
    expect(result).toHaveLength(1)
    expect(result[0]?.name).toBe("react-best-practices")
  })
})
