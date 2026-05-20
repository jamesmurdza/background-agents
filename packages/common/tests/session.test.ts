/**
 * Unit tests for buildSystemPrompt.
 *
 * Pure function — no mocks needed.
 */
import { describe, it, expect } from "vitest"
import { buildSystemPrompt } from "../src/session"
import type { SkillCatalogEntry } from "../src/session"

describe("buildSystemPrompt", () => {
  const repoPath = "/home/daytona/project"

  it("includes the repo path", () => {
    const prompt = buildSystemPrompt(repoPath)
    expect(prompt).toContain(repoPath)
  })

  it("omits the Agent Skills section when no skills are provided", () => {
    const prompt = buildSystemPrompt(repoPath)
    expect(prompt).not.toContain("Agent Skills")
    expect(prompt).not.toContain("<available_skills>")
  })

  it("omits the Agent Skills section when skills array is empty", () => {
    const prompt = buildSystemPrompt(repoPath, undefined, [])
    expect(prompt).not.toContain("Agent Skills")
    expect(prompt).not.toContain("<available_skills>")
  })

  it("injects <available_skills> catalog when skills are provided", () => {
    const skills: SkillCatalogEntry[] = [
      {
        name: "react-best-practices",
        description: "Enforces React patterns. Use when writing React components.",
        location: `${repoPath}/.agents/skills/react-best-practices/SKILL.md`,
      },
    ]

    const prompt = buildSystemPrompt(repoPath, undefined, skills)
    expect(prompt).toContain("## Agent Skills")
    expect(prompt).toContain("<available_skills>")
    expect(prompt).toContain("<name>react-best-practices</name>")
    expect(prompt).toContain("<description>Enforces React patterns. Use when writing React components.</description>")
    expect(prompt).toContain(`<location>${repoPath}/.agents/skills/react-best-practices/SKILL.md</location>`)
    expect(prompt).toContain("</available_skills>")
  })

  it("includes all skills in the catalog", () => {
    const skills: SkillCatalogEntry[] = [
      {
        name: "react-best-practices",
        description: "Enforces React patterns.",
        location: `${repoPath}/.agents/skills/react-best-practices/SKILL.md`,
      },
      {
        name: "code-review",
        description: "Reviews code for bugs and style.",
        location: `${repoPath}/.agents/skills/code-review/SKILL.md`,
      },
    ]

    const prompt = buildSystemPrompt(repoPath, undefined, skills)
    expect(prompt).toContain("<name>react-best-practices</name>")
    expect(prompt).toContain("<name>code-review</name>")
  })

  it("includes the preview URL section when a pattern is provided", () => {
    const prompt = buildSystemPrompt(repoPath, "https://preview.example.com/{port}")
    expect(prompt).toContain("preview URL")
    expect(prompt).toContain("https://preview.example.com/{port}")
  })

  it("omits the preview URL section when no pattern is provided", () => {
    const prompt = buildSystemPrompt(repoPath)
    expect(prompt).not.toContain("preview URL")
  })

  it("includes both skills catalog and preview URL when both are provided", () => {
    const skills: SkillCatalogEntry[] = [
      {
        name: "my-skill",
        description: "Does something.",
        location: `${repoPath}/.agents/skills/my-skill/SKILL.md`,
      },
    ]

    const prompt = buildSystemPrompt(repoPath, "https://preview.example.com/{port}", skills)
    expect(prompt).toContain("<available_skills>")
    expect(prompt).toContain("preview URL")
  })

  it("includes git rules", () => {
    const prompt = buildSystemPrompt(repoPath)
    expect(prompt).toContain("## Git Rules")
    expect(prompt).toContain("Do not push")
  })

  it("always includes the logs directory section", () => {
    const prompt = buildSystemPrompt(repoPath)
    expect(prompt).toContain("## Logs Directory")
  })
})
