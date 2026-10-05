import { describe, expect, it, vi } from "vitest"
import { ChatActionSlot } from "./ChatInput"

interface ActionSlotElementProps {
  "data-testid": string
  className: string
  children: {
    props: Record<string, unknown>
  } | null
}

function getActionSlot(overrides: Partial<Parameters<typeof ChatActionSlot>[0]> = {}) {
  return ChatActionSlot({
    isRunning: false,
    canQueue: false,
    canSend: false,
    isMobile: false,
    showBranchAffordance: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  })
}

describe("ChatActionSlot", () => {
  it("does not offer an enabled Stop before a cancellable turn exists", () => {
    const props = getActionSlot({ isRunning: true, canStop: false }).props as ActionSlotElementProps
    expect(props.children?.props.disabled).toBe(true)
    expect(props.children?.props.title).toBe("Agent is starting")
  })
  it.each([
    { layout: "desktop", isMobile: false },
    { layout: "mobile", isMobile: true },
  ])(
    "keeps a fixed action wrapper mounted in the $layout layout",
    ({ isMobile }) => {
      const running = getActionSlot({ isRunning: true, isMobile })
      const idle = getActionSlot({ isMobile })
      const runningProps = running.props as ActionSlotElementProps
      const idleProps = idle.props as ActionSlotElementProps

      expect(running.type).toBe("div")
      expect(idle.type).toBe("div")
      expect(runningProps["data-testid"]).toBe("chat-action-slot")
      expect(idleProps["data-testid"]).toBe("chat-action-slot")
      expect(runningProps.className).toBe(idleProps.className)
      expect(idleProps.children).toBeNull()
    }
  )

  it.each([
    {
      name: "queue",
      state: { isRunning: true, canQueue: true },
      label: "Queue message",
    },
    {
      name: "stop",
      state: { isRunning: true, canQueue: false },
      label: "Stop agent",
    },
    {
      name: "send",
      state: { isRunning: false, canSend: true },
      label: "Send message",
    },
  ])("renders the $name action for its composer state", ({ state, label }) => {
    const element = getActionSlot(state)
    const props = element.props as ActionSlotElementProps

    expect(props.children?.props["aria-label"]).toBe(label)
  })
})
