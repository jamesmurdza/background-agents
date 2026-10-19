/**
 * Unit tests for the daily balance.
 */
import { describe, it, expect } from "vitest"

import {
  getDailyBalance,
  isFreeModel,
  BALANCE_POOL_PROVIDERS,
} from "./usage-budgets"

describe("getDailyBalance", () => {
  it("gives every user a finite daily balance", () => {
    const balance = getDailyBalance()
    expect(balance).toBeGreaterThan(0)
    expect(Number.isFinite(balance)).toBe(true)
  })
})

describe("BALANCE_POOL_PROVIDERS", () => {
  it("covers every shared pool, so the balance can't be routed around", () => {
    // A provider missing here is an unmetered path: the user would keep working
    // on it with nothing left.
    expect([...BALANCE_POOL_PROVIDERS].sort()).toEqual([
      "claude",
      "gemini",
      "opencode",
    ])
  })
})

describe("isFreeModel", () => {
  it("catches the explicit set and the -free/:free conventions", () => {
    expect(isFreeModel("big-pickle")).toBe(true)
    expect(isFreeModel("nemotron-3-ultra-free")).toBe(true)
    expect(isFreeModel("some-new-model:free")).toBe(true)
    expect(isFreeModel("claude-opus-5")).toBe(false)
    expect(isFreeModel(null)).toBe(false)
  })
})
