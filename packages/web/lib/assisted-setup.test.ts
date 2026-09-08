import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { stageAssistedSetupPrompt, consumeAssistedSetupPrompt } from "./assisted-setup"

/**
 * A minimal in-memory sessionStorage stand-in (not jsdom: this repo has none)
 * so the stage/consume round trip can be exercised without a real browser.
 */
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
}

describe("stageAssistedSetupPrompt / consumeAssistedSetupPrompt", () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = globalThis
    ;(globalThis as { sessionStorage?: Storage }).sessionStorage = makeMemoryStorage()
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage
  })

  it("returns null with nothing staged", () => {
    expect(consumeAssistedSetupPrompt("chat_1")).toBeNull()
  })

  it("round-trips a staged prompt for the right chat id", () => {
    stageAssistedSetupPrompt("chat_1", "hello agent")
    expect(consumeAssistedSetupPrompt("chat_1")).toBe("hello agent")
  })

  it("consumes only once: a second read finds nothing", () => {
    stageAssistedSetupPrompt("chat_1", "hello agent")
    consumeAssistedSetupPrompt("chat_1")
    expect(consumeAssistedSetupPrompt("chat_1")).toBeNull()
  })

  it("does not leak a staged prompt to a different chat id", () => {
    stageAssistedSetupPrompt("chat_1", "for chat 1")
    expect(consumeAssistedSetupPrompt("chat_2")).toBeNull()
    // Still there for the chat it was actually staged for.
    expect(consumeAssistedSetupPrompt("chat_1")).toBe("for chat 1")
  })
})

describe("without a window (server-side import)", () => {
  it("stage is a silent no-op and consume returns null", () => {
    expect(() => stageAssistedSetupPrompt("chat_1", "x")).not.toThrow()
    expect(consumeAssistedSetupPrompt("chat_1")).toBeNull()
  })
})
