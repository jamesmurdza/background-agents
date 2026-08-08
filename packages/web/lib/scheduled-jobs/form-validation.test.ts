import { describe, expect, it } from "vitest"
import {
  getFirstInvalidScheduledJobField,
  validateScheduledJobForm,
} from "./form-validation"

describe("validateScheduledJobForm", () => {
  it("reports every missing required field in one pass", () => {
    expect(validateScheduledJobForm({
      name: "   ",
      prompt: "",
      triggerType: "interval",
      intervalMinutes: 60,
    })).toEqual({
      name: "Name is required",
      prompt: "Prompt is required",
    })
  })

  it("accepts trimmed values and a valid interval", () => {
    expect(validateScheduledJobForm({
      name: " Dependency updates ",
      prompt: " Update dependencies ",
      triggerType: "interval",
      intervalMinutes: 60,
    })).toEqual({})
  })

  it("rejects interval schedules shorter than ten minutes", () => {
    expect(validateScheduledJobForm({
      name: "Dependency updates",
      prompt: "Update dependencies",
      triggerType: "interval",
      intervalMinutes: 9,
    })).toEqual({
      interval: "Interval must be at least 10 minutes",
    })
  })

  it("does not apply interval validation to webhook triggers", () => {
    expect(validateScheduledJobForm({
      name: "Dependency updates",
      prompt: "Update dependencies",
      triggerType: "incoming",
      intervalMinutes: 1,
    })).toEqual({})
  })
})

describe("getFirstInvalidScheduledJobField", () => {
  it("uses visual form order when multiple fields are invalid", () => {
    expect(getFirstInvalidScheduledJobField({
      prompt: "Prompt is required",
      name: "Name is required",
    })).toBe("name")

    expect(getFirstInvalidScheduledJobField({
      prompt: "Prompt is required",
      interval: "Interval must be at least 10 minutes",
    })).toBe("interval")
  })

  it("returns null when the form is valid", () => {
    expect(getFirstInvalidScheduledJobField({})).toBeNull()
  })
})
