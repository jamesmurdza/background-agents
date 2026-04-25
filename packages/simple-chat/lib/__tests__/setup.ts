/**
 * Vitest Setup
 *
 * Configures the test environment for React Testing Library and mocks.
 */

import "@testing-library/jest-dom"
import { vi } from "vitest"

// Mock window.localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, "localStorage", { value: localStorageMock })

// Mock window.sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, "sessionStorage", { value: sessionStorageMock })

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: null,
    status: "unauthenticated",
  })),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock EventSource
class MockEventSource {
  url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  listeners: Map<string, ((event: Event) => void)[]> = new Map()

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const existing = this.listeners.get(type) ?? []
    this.listeners.set(type, [...existing, listener])
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    const existing = this.listeners.get(type) ?? []
    this.listeners.set(type, existing.filter((l) => l !== listener))
  }

  close() {
    this.readyState = 2
  }

  // Test helper: simulate receiving an event
  __emit(type: string, data: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) })
    const listeners = this.listeners.get(type) ?? []
    for (const listener of listeners) {
      listener(event)
    }
  }
}

// @ts-expect-error - mock
global.EventSource = MockEventSource

// Reset stores between tests
beforeEach(() => {
  localStorageMock.clear()
  sessionStorageMock.clear()
  vi.clearAllMocks()
})
