import { describe, expect, it } from "vitest"
import { resolveEnvironmentPicker } from "./EnvironmentCombobox"
import type { EnvironmentDTO } from "@/lib/environments"

function env(overrides: Partial<EnvironmentDTO> = {}): EnvironmentDTO {
  return {
    id: "env_1",
    repo: "acme/app",
    name: "Default",
    isDefault: true,
    networkMode: "full",
    allowedDomains: [],
    variables: {},
    hasSetupScript: false,
    setupScript: null,
    setupScriptUpdatedBy: null,
    updatedAt: 0,
    ...overrides,
  }
}

describe("resolveEnvironmentPicker", () => {
  it("hides the picker when there are no environments and no value", () => {
    const result = resolveEnvironmentPicker([], null)
    expect(result.visible).toBe(false)
    expect(result.selected).toBeUndefined()
  })

  it("hides the picker for a single environment before any value is pinned", () => {
    const environments = [env()]
    const result = resolveEnvironmentPicker(environments, null)
    expect(result.visible).toBe(false)
  })

  it("shows a single environment once a value is pinned, selecting it", () => {
    const environments = [env({ id: "env_1" })]
    const result = resolveEnvironmentPicker(environments, "env_1")
    expect(result.visible).toBe(true)
    expect(result.selected?.id).toBe("env_1")
  })

  it("shows the picker for two or more environments even with no value, selecting the default", () => {
    const environments = [
      env({ id: "env_1", isDefault: true, name: "Default" }),
      env({ id: "env_2", isDefault: false, name: "Staging" }),
    ]
    const result = resolveEnvironmentPicker(environments, null)
    expect(result.visible).toBe(true)
    expect(result.selected?.id).toBe("env_1")
  })

  it("falls back to the default when the value doesn't match any environment", () => {
    const environments = [
      env({ id: "env_1", isDefault: true, name: "Default" }),
      env({ id: "env_2", isDefault: false, name: "Staging" }),
    ]
    const result = resolveEnvironmentPicker(environments, "env_deleted")
    expect(result.visible).toBe(true)
    expect(result.selected?.id).toBe("env_1")
  })

  it("selects the pinned non-default environment when it matches", () => {
    const environments = [
      env({ id: "env_1", isDefault: true, name: "Default" }),
      env({ id: "env_2", isDefault: false, name: "Staging" }),
    ]
    const result = resolveEnvironmentPicker(environments, "env_2")
    expect(result.visible).toBe(true)
    expect(result.selected?.id).toBe("env_2")
  })
})
