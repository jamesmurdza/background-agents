import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ThinkingCapability } from "@background-agents/sdk/thinking"
import type { ThinkingRecoveryRequest } from "@/lib/thinking-recovery"

const mocks = vi.hoisted(() => ({
  states: [] as unknown[], stateIndex: 0,
  refs: [] as Array<{ current: unknown }>, refIndex: 0,
  ready: true, thinking: "high", capability: { levels: ["low", "high"] } as ThinkingCapability,
  notice: undefined as string | undefined,
  setThinking: vi.fn(), requestThinking: vi.fn(), confirm: vi.fn(), cancel: vi.fn(),
}))
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = mocks.stateIndex++
    return [index in mocks.states ? mocks.states[index] : initial,
      (value: unknown) => { mocks.states[index] = value }]
  },
  useRef: (current: unknown) => mocks.refs[mocks.refIndex++] ??= { current },
  useEffect: () => {},
}))
vi.mock("@/lib/hooks/useThinkingPreference", () => ({
  useThinkingPreference: () => ({
    thinking: mocks.thinking, setThinking: mocks.setThinking, capability: mocks.capability,
    ready: mocks.ready, notice: mocks.notice, requestThinking: mocks.requestThinking, onThinkingMenuOpen: vi.fn(), recheckThinking: vi.fn(),
  }),
}))

import { ThinkingRecoveryDialog } from "./ThinkingRecoveryDialog"
import { ThinkingSelector } from "./ThinkingSelector"

const request: ThinkingRecoveryRequest = {
  id: "one", chatId: "chat", content: "Keep this", agent: "codex", model: "gpt-6-luna",
  originalAgent: "codex", originalModel: "gpt-6.1-sol", originalThinking: "ultra",
}

function elements(value: unknown): Array<ReactElement<Record<string, unknown>>> {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!value || typeof value !== "object" || !("props" in value)) return []
  const element = value as ReactElement<Record<string, unknown>>
  return [element, ...elements(element.props.children)]
}

function render(value = request) {
  mocks.refIndex = mocks.stateIndex = 0
  const tree = elements(ThinkingRecoveryDialog({ request: value, sandboxId: "sandbox", onCancel: mocks.cancel, onConfirm: mocks.confirm }))
  const button = (label: string) => tree.find(element => element.type === "button" && element.props.children === label)!
  return { tree, confirm: button("Confirm and retry"), cancel: button("Cancel"), useDefault: button("Use Default for this retry"), selector: tree.find(element => element.type === ThinkingSelector)! }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.states = []; mocks.stateIndex = 0; mocks.refs = []; mocks.refIndex = 0
  mocks.confirm.mockReset()
  mocks.ready = true; mocks.thinking = "high"; mocks.capability = { levels: ["low", "high"] }
  mocks.notice = undefined
})

describe("recovery dialog action contract (controlled hook state)", () => {
  it("renders invalid selection guidance in the dialog flow rather than an overlay covering model details", () => {
    mocks.notice = "Choose a supported thinking setting or Default before sending."
    mocks.capability = { levels: [] }
    mocks.ready = false
    const view = render()
    expect(view.selector.props.notice).toBeUndefined()
    const status = view.tree.find(element => element.type === "p" && element.props.role === "status" && element.props.children === mocks.notice)
    expect(status).toBeDefined()
    expect(status!.props.className).not.toContain("absolute")
    expect(view.confirm.props.disabled).toBe(true)
  })
  it("does not auto-confirm a saved preference", () => {
    const view = render()
    expect(view.confirm.props.disabled).toBe(true)
    ;(view.confirm.props.onClick as () => void)()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it("explicit Default works even when it is the only available setting", () => {
    mocks.capability = { status: "no_controls", levels: [] }
    mocks.thinking = "default"
    expect(render().confirm.props.disabled).toBe(true)
    ;(render().useDefault.props.onClick as () => void)()
    const view = render()
    expect(view.confirm.props.disabled).toBe(false)
    ;(view.confirm.props.onClick as () => void)()
    ;(view.confirm.props.onClick as () => void)()
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm).toHaveBeenCalledWith("one", "default")
  })

  it("a late capability result invalidates both the button and its stale click handler", () => {
    ;(render().selector.props.onChange as (value: string) => void)("high")
    const previous = render()
    expect(previous.confirm.props.disabled).toBe(false)
    mocks.capability = { levels: ["low"] }
    const latest = render()
    expect(latest.confirm.props.disabled).toBe(true)
    ;(previous.confirm.props.onClick as () => void)()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it("changing target cannot reuse consent for the previous target", () => {
    ;(render().selector.props.onChange as (value: string) => void)("high")
    const previous = render()
    expect(render({ ...request, model: "gpt-6.1-sol" }).confirm.props.disabled).toBe(true)
    ;(previous.confirm.props.onClick as () => void)()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it("discovery still in progress with no ready selection cannot send", () => {
    ;(render().selector.props.onChange as (value: string) => void)("high")
    mocks.ready = false
    const view = render()
    expect(view.confirm.props.disabled).toBe(true)
    ;(view.confirm.props.onClick as () => void)()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it("Cancel does not dispatch the request", () => {
    ;(render().cancel.props.onClick as () => void)()
    expect(mocks.cancel).toHaveBeenCalledOnce()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it("a per-retry Default choice does not overwrite saved preferences, including after Cancel", () => {
    ;(render().useDefault.props.onClick as () => void)()
    ;(render().cancel.props.onClick as () => void)()
    expect(mocks.requestThinking).toHaveBeenCalledWith("default")
    expect(mocks.setThinking).not.toHaveBeenCalled()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it("an unsupported per-retry choice cannot replace the user's current intent", () => {
    ;(render().selector.props.onChange as (value: string) => void)("ultra")
    expect(mocks.requestThinking).not.toHaveBeenCalled()
    expect(render().confirm.props.disabled).toBe(true)
  })

  it("keeps the pending confirmation single-flight and allows an explicit retry after a blocked result", async () => {
    let complete!: (value: { status: "blocked"; message: string }) => void
    mocks.confirm.mockReturnValueOnce(new Promise(resolve => { complete = resolve }))
    ;(render().useDefault.props.onClick as () => void)()
    const view = render()
    const sending = (view.confirm.props.onClick as () => Promise<void>)()
    const pending = render()
    expect(pending.confirm.props.disabled).toBe(true)
    expect(pending.cancel.props.disabled).toBe(true)
    ;(view.cancel.props.onClick as () => void)()
    ;(view.confirm.props.onClick as () => void)()
    expect(mocks.cancel).not.toHaveBeenCalled()
    expect(mocks.confirm).toHaveBeenCalledOnce()
    complete({ status: "blocked", message: "Wait for this turn" })
    await sending
    const retained = render()
    expect(retained.confirm.props.disabled).toBe(false)
    expect(retained.cancel.props.disabled).toBe(false)
    await (retained.confirm.props.onClick as () => Promise<void>)()
    expect(mocks.confirm).toHaveBeenCalledTimes(2)
  })
})
