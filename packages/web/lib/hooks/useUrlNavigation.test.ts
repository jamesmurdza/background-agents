/**
 * Unit tests for the client-side route table. Pure functions — the URL parsing
 * that drives useUrlSync must stay in sync with the ROUTES builders.
 */
import { describe, it, expect } from "vitest"
import { ROUTES, matchRoute } from "@/lib/hooks/useUrlNavigation"

describe("matchRoute", () => {
  it("matches agent deep links and extracts the slug", () => {
    expect(matchRoute("/agent/factory")).toEqual({ route: "agent", slug: "factory" })
    expect(matchRoute("/agent/kimi")).toEqual({ route: "agent", slug: "kimi" })
    expect(matchRoute("/agent/claude-code")).toEqual({ route: "agent", slug: "claude-code" })
  })

  it("does not treat nested agent paths as an agent route", () => {
    expect(matchRoute("/agent/factory/extra")).toBeNull()
    // Bare /agent has no slug and should not match.
    expect(matchRoute("/agent")).toBeNull()
  })

  it("still matches the existing routes", () => {
    expect(matchRoute("/")).toEqual({ route: "home" })
    expect(matchRoute("/chat/new")).toEqual({ route: "newChat" })
    expect(matchRoute("/chat/abc123")).toEqual({ route: "chat", chatId: "abc123" })
    expect(matchRoute("/jobs")).toEqual({ route: "jobs" })
  })
})

describe("ROUTES.agent", () => {
  it("builds and round-trips", () => {
    const path = ROUTES.agent.build("factory")
    expect(path).toBe("/agent/factory")
    expect(ROUTES.agent.match(path)).toEqual({ slug: "factory" })
  })
})
