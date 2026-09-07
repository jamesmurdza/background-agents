/**
 * Unit tests for the diff cursor's keying rules.
 *
 * These exist because the bug they cover was invisible by inspection: the
 * lookup key and the stored key were computed a few lines apart and looked
 * interchangeable. They are not, and the cost of getting it wrong is a turn
 * charged the session's entire history instead of its delta.
 */
import { describe, it, expect } from "vitest"

import {
  collapseEntriesByModel,
  cursorForModel,
  sumCumulatives,
  chatPredatesMetering,
  realAssistantTurnFilter,
  METERING_START,
  ZERO_CUMULATIVE,
  type SessionCumulative,
} from "./usage-cursor"

/** A cursor entry with every component set to `n`, for terse assertions. */
const cume = (n: number): SessionCumulative => ({
  inputTokens: n,
  outputTokens: n,
  cacheReadTokens: n,
  cacheWriteTokens: n,
  reasoningTokens: n,
  totalTokens: n,
  costUsd: n,
})

describe("sumCumulatives", () => {
  it("returns zero for no parts", () => {
    expect(sumCumulatives()).toEqual(ZERO_CUMULATIVE)
  })

  it("skips absent parts rather than treating them as zero-valued objects", () => {
    expect(sumCumulatives(undefined, cume(3), undefined)).toEqual(cume(3))
  })

  it("adds every component", () => {
    expect(sumCumulatives(cume(2), cume(5))).toEqual(cume(7))
  })

  it("does not mutate its inputs or the shared zero", () => {
    const a = cume(1)
    sumCumulatives(a, cume(4))
    expect(a).toEqual(cume(1))
    expect(ZERO_CUMULATIVE).toEqual(cume(0))
  })
})

describe("cursorForModel", () => {
  it("looks up the id the row is STORED under, not the one tokscale reported", () => {
    // The regression: Droid reports "byok-0", we store "gemini-3-flash".
    // Keying on the reported id found nothing, so the turn was charged the
    // whole session cumulative instead of its delta.
    const prior = new Map([["gemini-3-flash", cume(500)]])
    expect(cursorForModel(prior, "byok-0", "gemini-3-flash")).toEqual(cume(500))
  })

  it("sums both ids for a session that straddles the fix", () => {
    // Rows written before the fix sit under the placeholder; rows written
    // after sit under the resolved id. Taking either half alone would
    // understate the cursor and overcharge the turn by the other half.
    const prior = new Map([
      ["byok-0", cume(100)],
      ["gemini-3-flash", cume(400)],
    ])
    expect(cursorForModel(prior, "byok-0", "gemini-3-flash")).toEqual(cume(500))
  })

  it("does not double-count when the id was never rewritten", () => {
    const prior = new Map([["claude-fable-5", cume(700)]])
    expect(cursorForModel(prior, "claude-fable-5", "claude-fable-5")).toEqual(
      cume(700)
    )
  })

  it("treats a null model as the empty-string key both modules agree on", () => {
    const prior = new Map([["", cume(9)]])
    expect(cursorForModel(prior, null, null)).toEqual(cume(9))
  })

  it("returns zero on a genuine first capture", () => {
    expect(cursorForModel(new Map(), "claude-fable-5", "claude-fable-5")).toEqual(
      ZERO_CUMULATIVE
    )
  })
})

describe("collapseEntriesByModel", () => {
  const entry = (model: string | null, input: number) => ({
    model,
    input,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  })

  it("passes distinct models through untouched", () => {
    const given = [entry("claude-fable-5", 10), entry("gemini-3-flash", 20)]
    const got = collapseEntriesByModel(given)
    expect(got.entries).toEqual(given)
    expect(got.collapsed).toBe(0)
    expect(got.conflicted).toEqual([])
  })

  it("collapses a model tokscale reported twice", () => {
    // The regression: one tokscale run reporting the same (session, model)
    // twice wrote two rows from a single insert, each diffed against the same
    // cursor, so the turn was charged twice.
    const got = collapseEntriesByModel([
      entry("claude-fable-5", 100),
      entry("claude-fable-5", 100),
    ])
    expect(got.entries).toEqual([entry("claude-fable-5", 100)])
    expect(got.collapsed).toBe(1)
    expect(got.conflicted).toEqual([])
  })

  it("keeps the high-water mark, never the sum", () => {
    // A cumulative is a high-water mark. Summing would invent usage: 100 and
    // 140 are two readings of one counter, not 240 tokens.
    const got = collapseEntriesByModel([
      entry("claude-fable-5", 100),
      entry("claude-fable-5", 140),
      entry("claude-fable-5", 120),
    ])
    expect(got.entries).toEqual([entry("claude-fable-5", 140)])
    expect(got.collapsed).toBe(2)
  })

  it("reports models whose entries disagreed, so the caller can log it", () => {
    const got = collapseEntriesByModel([
      entry("claude-fable-5", 100),
      entry("claude-fable-5", 140),
      entry("gemini-3-flash", 5),
      entry("gemini-3-flash", 5),
    ])
    expect(got.conflicted).toEqual(["claude-fable-5"])
  })

  it("treats a null model as its own key rather than dropping it", () => {
    const got = collapseEntriesByModel([entry(null, 7), entry("claude-fable-5", 3)])
    expect(got.entries).toHaveLength(2)
    expect(got.collapsed).toBe(0)
  })

  it("handles an empty list", () => {
    expect(collapseEntriesByModel([])).toEqual({
      entries: [],
      collapsed: 0,
      conflicted: [],
    })
  })
})

/**
 * The baseline gate. A backdated row is a free row, so every case here is
 * really the question "does this chat get its next turn for nothing?".
 */
describe("chatPredatesMetering", () => {
  const before = new Date(METERING_START.getTime() - 1)
  const after = new Date(METERING_START.getTime() + 1)

  it("is true only for a chat older than the day metering began", () => {
    expect(chatPredatesMetering(before)).toBe(true)
    expect(chatPredatesMetering(after)).toBe(false)
  })

  it("excludes a chat created exactly at the boundary", () => {
    // Metering was running from this instant, so there is no backlog.
    expect(chatPredatesMetering(METERING_START)).toBe(false)
  })

  it("is false for every chat created since — the regression that leaked $1,241.70", () => {
    // The old test would have backdated all of these the moment a crashed or
    // errored first turn left the session without a usage row.
    expect(chatPredatesMetering(new Date("2026-09-05T20:00:09.085Z"))).toBe(false)
    expect(chatPredatesMetering(new Date("2026-07-01T00:00:00.000Z"))).toBe(false)
  })

  it("treats an unknown creation date as recent, so the turn is charged", () => {
    // Charging a turn that should have been free is recoverable; giving one
    // away silently is not.
    expect(chatPredatesMetering(null)).toBe(false)
    expect(chatPredatesMetering(undefined)).toBe(false)
  })

  it("honours an injected boundary, so the rule is not pinned to one date", () => {
    const start = new Date("2026-01-01T00:00:00.000Z")
    expect(chatPredatesMetering(new Date("2025-12-31T23:59:59Z"), start)).toBe(true)
    expect(chatPredatesMetering(new Date("2026-01-02T00:00:00Z"), start)).toBe(false)
  })
})

describe("realAssistantTurnFilter", () => {
  it("counts only assistant messages that could have spent tokens", () => {
    // Each exclusion is a way production produced an assistant row with no LLM
    // call behind it; counting any of them let one failed turn pass for a
    // pre-metering backlog.
    expect(realAssistantTurnFilter("chat_1")).toEqual({
      chatId: "chat_1",
      role: "assistant",
      isError: false,
      content: { not: "" },
      OR: [{ messageType: null }, { messageType: { not: "git-operation" } }],
    })
  })

  it("keeps messages whose messageType is null — an ordinary chat turn", () => {
    // `{ not: "git-operation" }` alone compiles to SQL `<>`, and
    // `NULL <> 'git-operation'` is NULL, so the terse form drops every normal
    // message and disables the backlog check completely.
    const { OR } = realAssistantTurnFilter("chat_1")
    expect(OR).toContainEqual({ messageType: null })
  })
})
