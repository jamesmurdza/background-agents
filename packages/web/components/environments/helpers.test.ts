import { describe, it, expect } from "vitest"
import {
  groupEnvironmentsByRepo,
  recordToEnvVars,
  envVarsToRecord,
  nextEnvironmentName,
} from "./helpers"
import type { EnvironmentDTO } from "@/lib/environments"

function makeEnv(overrides: Partial<EnvironmentDTO>): EnvironmentDTO {
  return {
    id: "id",
    repo: "owner/repo",
    name: "Default",
    isDefault: true,
    networkMode: "full",
    allowedDomains: [],
    variables: {},
    variableCount: 0,
    hasSetupScript: false,
    setupScript: null,
    setupScriptUpdatedBy: null,
    updatedAt: 0,
    ...overrides,
  }
}

describe("groupEnvironmentsByRepo", () => {
  it("groups environments under their repo key", () => {
    const envs = [
      makeEnv({ id: "1", repo: "a/one", name: "Default" }),
      makeEnv({ id: "2", repo: "b/two", name: "Default" }),
      makeEnv({ id: "3", repo: "a/one", name: "Staging", isDefault: false }),
    ]

    const grouped = groupEnvironmentsByRepo(envs)

    expect(Object.keys(grouped)).toEqual(["a/one", "b/two"])
    expect(grouped["a/one"].map((e) => e.id)).toEqual(["1", "3"])
    expect(grouped["b/two"].map((e) => e.id)).toEqual(["2"])
  })

  it("returns an empty object for an empty list", () => {
    expect(groupEnvironmentsByRepo([])).toEqual({})
  })
})

describe("recordToEnvVars / envVarsToRecord round trip", () => {
  it("converts a record to rows and back", () => {
    const record = { API_KEY: "secret", DEBUG: "true" }
    const rows = recordToEnvVars(record)

    expect(rows).toHaveLength(2)
    expect(rows.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true)

    expect(envVarsToRecord(rows)).toEqual(record)
  })

  it("drops rows with an empty or whitespace-only key", () => {
    const rows = [
      { id: "1", key: "KEY", value: "value" },
      { id: "2", key: "", value: "ignored" },
      { id: "3", key: "   ", value: "ignored" },
    ]

    expect(envVarsToRecord(rows)).toEqual({ KEY: "value" })
  })

  it("trims keys and lets the last duplicate win", () => {
    const rows = [
      { id: "1", key: " KEY ", value: "first" },
      { id: "2", key: "KEY", value: "second" },
    ]

    expect(envVarsToRecord(rows)).toEqual({ KEY: "second" })
  })

  it("returns an empty object for an empty list", () => {
    expect(envVarsToRecord([])).toEqual({})
  })
})

describe("nextEnvironmentName", () => {
  it("returns 'New environment 1' when there are no existing names", () => {
    expect(nextEnvironmentName([])).toBe("New environment 1")
  })

  it("fills a gap left by a deleted or renamed environment", () => {
    expect(nextEnvironmentName(["New environment 2"])).toBe("New environment 1")
  })

  it("does not propose a name already taken by a sibling (regression)", () => {
    const name = nextEnvironmentName(["Default", "New environment 3"])
    expect(name).not.toBe("New environment 3")
    expect(name).toBe("New environment 1")
  })

  it("ignores unrelated names when picking the next number", () => {
    expect(nextEnvironmentName(["Default", "Staging", "prod"])).toBe("New environment 1")
  })

  it("treats names as taken when they differ only by surrounding whitespace or case", () => {
    expect(nextEnvironmentName([" new environment 1 "])).toBe("New environment 2")
    expect(nextEnvironmentName(["NEW ENVIRONMENT 1"])).toBe("New environment 2")
  })
})
