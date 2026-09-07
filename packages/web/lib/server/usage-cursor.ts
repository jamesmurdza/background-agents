/**
 * The TokenUsage diff cursor: how a turn's delta finds what was already
 * recorded for its (session, model).
 *
 * Every ledger row holds a per-turn delta, so the sum of prior deltas for a
 * (session, model) equals tokscale's cumulative at the last capture, and the
 * next delta is (current cumulative − that sum). Getting the lookup key wrong
 * therefore does not merely mislabel a row: `prev` falls back to zero and the
 * turn is charged the session's entire history.
 *
 * Kept free of database imports — like lib/server/turn-pricing — so the keying
 * rules can be unit-tested directly.
 */

/** The part of a tokscale entry that carries a model's cumulative counts. */
export interface ModelCumulativeEntry {
  model: string | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
}

/**
 * Reduce tokscale's entries to at most one per model.
 *
 * `--group-by session,model` should already guarantee that, but production
 * shows it does not: 19 ledger rows were written by a single insert because
 * one tokscale run reported the same (session, model) twice. Both were diffed
 * against the same cursor, so both charged the full delta.
 *
 * A model's cumulative is a high-water mark, so the largest entry is the
 * truthful one and summing would invent usage that never happened. Entries
 * that disagree are reported in `conflicted` for the caller to log — that
 * would mean tokscale is partitioning one model across rows, which is worth
 * knowing about rather than silently resolving.
 */
export function collapseEntriesByModel<T extends ModelCumulativeEntry>(
  entries: T[]
): { entries: T[]; collapsed: number; conflicted: string[] } {
  const total = (e: T) =>
    e.input + e.output + e.cacheRead + e.cacheWrite + e.reasoning

  const best = new Map<string, T>()
  const conflicted = new Set<string>()

  for (const entry of entries) {
    const key = entry.model ?? ""
    const held = best.get(key)
    if (!held) {
      best.set(key, entry)
      continue
    }
    if (total(entry) !== total(held)) conflicted.add(key)
    if (total(entry) > total(held)) best.set(key, entry)
  }

  const kept = [...best.values()]
  return {
    entries: kept,
    collapsed: entries.length - kept.length,
    conflicted: [...conflicted],
  }
}

/** Prior cumulative totals for one (session, model) pair, per component. */
export interface SessionCumulative {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
}

export const ZERO_CUMULATIVE: SessionCumulative = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
  costUsd: 0,
}

/** Add cursor entries together, skipping any that are absent. */
export function sumCumulatives(
  ...parts: (SessionCumulative | undefined)[]
): SessionCumulative {
  const out: SessionCumulative = { ...ZERO_CUMULATIVE }
  for (const part of parts) {
    if (!part) continue
    out.inputTokens += part.inputTokens
    out.outputTokens += part.outputTokens
    out.cacheReadTokens += part.cacheReadTokens
    out.cacheWriteTokens += part.cacheWriteTokens
    out.reasoningTokens += part.reasoningTokens
    out.totalTokens += part.totalTokens
    out.costUsd += part.costUsd
  }
  return out
}

/**
 * The cursor for a turn, given the prior deltas grouped by the model id as
 * *stored*.
 *
 * `reported` is the id tokscale printed; `resolved` is what resolveTurnModel
 * turned it into and therefore what the row is filed under. Those differ
 * whenever the CLI emits a placeholder (Droid's `byok-0`, Claude Code's
 * `<synthetic>`), and looking up by `reported` — as this did until we found 41
 * (session, model) pairs in production re-charging their whole cumulative —
 * misses every row written under the resolved id.
 *
 * Both keys are summed rather than preferred one over the other: a session
 * straddling this fix has rows under each id, and they describe the same model
 * stream. Taking only one half would understate the cursor and overcharge the
 * turn by whatever the other half held.
 */
export function cursorForModel(
  prior: Map<string, SessionCumulative>,
  reported: string | null | undefined,
  resolved: string | null | undefined
): SessionCumulative {
  const key = resolved ?? ""
  const rawKey = reported ?? ""
  return sumCumulatives(
    prior.get(key),
    rawKey !== key ? prior.get(rawKey) : undefined
  )
}

// =============================================================================
// The baseline: where a session's cursor starts
// =============================================================================
// A session whose first capture finds no prior rows has no cursor, so the delta
// is tokscale's whole cumulative. For a chat that ran before metering existed,
// that cumulative covers a backlog nobody was ever charged for, and billing it
// as one turn would empty a day's budget in a single send. Such rows are
// written backdated to the epoch: they still advance the cursor (the cursor sum
// has no date filter) but sit outside every budget window, and they are not
// debited.
//
// The danger is the opposite error. Backdating a chat that does NOT have a
// backlog hands its first real turn away for nothing, and that is exactly what
// happened: the test used to be "no rows for this session AND more than one
// assistant message", which treats a missing usage row as evidence of age. It
// is not evidence of anything. A brand-new chat has no rows the moment its
// first turn fails to produce one — a crash, an error notice, a git-operation
// message, or tokscale not having flushed yet — and the next turn then satisfied
// both halves. 482 chats and $1,241.70 went unbilled that way.

/**
 * When token metering went live in production: the oldest real TokenUsage row
 * (2026-06-15 17:54 UTC), rounded down to the day.
 */
export const METERING_START = new Date("2026-06-15T00:00:00.000Z")

/**
 * Whether a chat can possibly hold usage that was never recorded.
 *
 * Age is the only sound test. A chat created once metering was running has been
 * metered since its first turn, so it has no backlog to forgive however broken
 * its message history looks. An unknown creation date is treated as recent —
 * charging a turn is recoverable, giving one away silently is not.
 */
export function chatPredatesMetering(
  chatCreatedAt: Date | null | undefined,
  meteringStart: Date = METERING_START
): boolean {
  if (!chatCreatedAt) return false
  return chatCreatedAt.getTime() < meteringStart.getTime()
}

/**
 * Prisma filter for assistant messages that could actually have spent tokens.
 *
 * Error notices (`markChatError`), git-operation messages and the empty shell
 * left by a crashed turn are all `role: "assistant"` rows. Counting them is
 * what let one failed turn pass for a pre-metering backlog, so they are all
 * excluded here.
 *
 * The messageType clause is spelled as an explicit null-or-not-git OR rather
 * than a bare `{ not: "git-operation" }`, because that compiles to SQL `<>`,
 * and `NULL <> 'git-operation'` is NULL, not true. An ordinary chat message
 * has no messageType at all, so the terse version excludes very nearly every
 * real turn — it silently disabled the backlog check entirely, which the
 * pre-metering control in scripts/repro-metering-bugs.ts caught.
 */
export function realAssistantTurnFilter(chatId: string) {
  return {
    chatId,
    role: "assistant",
    isError: false,
    content: { not: "" },
    OR: [{ messageType: null }, { messageType: { not: "git-operation" } }],
  }
}
