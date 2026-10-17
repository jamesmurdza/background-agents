import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ThinkingCapability } from "@background-agents/sdk/thinking"
import { ThinkingSelector } from "./ThinkingSelector"

const noControls: ThinkingCapability = { status: "no_controls", levels: [] }

function render(capability = noControls, value = "default", extras: { notice?: string; checking?: boolean } = {}) {
  const onChange = vi.fn()
  const html = renderToStaticMarkup(createElement(ThinkingSelector, { capability, value, onChange, ...extras }))
  // Rendering/discovery must never silently rewrite the user's preference.
  expect(onChange).not.toHaveBeenCalled()
  return html
}

describe("thinking control visibility", () => {
  it("omits a verified Default-only control without leaving an empty wrapper", () => {
    expect(render()).toBe("")
    expect(render({ ...noControls, levels: ["default"] })).toBe("")
  })

  it.each(["available", "unverified", "runtime_unavailable", "check_failed"] as const)(
    "keeps %s discovery visible even when levels are empty", status => {
      expect(render({ status, levels: [] })).toContain('aria-label="Thinking level"')
    },
  )

  it("does not infer verified no-controls from a legacy empty response", () => {
    expect(render({ levels: [] })).toContain('aria-label="Thinking level"')
  })

  it("keeps adjustable levels and token budgets visible", () => {
    expect(render({ status: "available", levels: ["low", "high"] })).toContain('aria-label="Thinking level"')
    expect(render({ status: "available", levels: [], budget: { min: 1024, max: 8192 } }, "budget:2048"))
      .toContain('aria-label="Thinking token budget"')
  })

  it("preserves an incompatible saved selection so the user can explicitly choose Default", () => {
    expect(render(noControls, "high")).toContain('aria-invalid="true"')
  })

  it("keeps actionable notices visible without flashing a known Default-only control during rechecks", () => {
    expect(render(noControls, "default", { notice: "Preferences could not be saved." })).toContain("Preferences could not be saved.")
    expect(render(noControls, "default", { checking: true })).toBe("")
    expect(render({ status: "unverified", levels: [] }, "default", { checking: true })).toContain('aria-busy="true"')
  })

  it("does not hide contradictory capability payloads with actual controls", () => {
    expect(render({ ...noControls, levels: ["high"] })).toContain('aria-label="Thinking level"')
    expect(render({ ...noControls, budget: { min: 1024, max: 8192 } })).toContain('aria-label="Thinking level"')
  })
})
