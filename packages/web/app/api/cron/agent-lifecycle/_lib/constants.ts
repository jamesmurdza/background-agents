// Hard timeouts for agent runs, in minutes. Past these the cron forcibly stops
// the agent and marks the chat/run as errored.
export const INTERACTIVE_HARD_TIMEOUT = 25 // minutes
export const SCHEDULED_HARD_TIMEOUT = 20 // minutes

// ── Mid-turn credit guard (see ./credit-guard) ───────────────────────────────

/**
 * How long a turn must have been running before the guard samples it.
 *
 * Measured, not guessed: on Claude Code tokscale reports nothing at all for the
 * first ~110 seconds of a turn — the session file exists, but no assistant
 * message carrying a usage record has been written yet, so every earlier sample
 * reads $0 and tells us nothing. (OpenCode reports from ~15s, but one threshold
 * for both is simpler than a per-agent table for the sake of one minute.)
 * Sampling below this only spends a sandbox round-trip to learn nothing.
 */
export const CREDIT_GUARD_MIN_RUN_MINUTES = 2

/**
 * How far ahead the guard has to keep the balance solvent, in minutes.
 *
 * Two lags stack up between a token being burnt and this cron being able to act
 * on it: tokscale's figure only advances when an assistant message completes,
 * which was observed sitting flat for up to ~2 minutes mid-run before jumping
 * by the whole accumulated amount; and the cron itself only looks once a
 * minute. So a balance that merely looks positive right now can already be
 * spent. Stopping while this much projected spend still fits is what turns
 * "stop at zero" into "stop before zero".
 */
export const CREDIT_GUARD_LOOKAHEAD_MINUTES = 3

// There is deliberately no "balance too high to bother sampling" ceiling. It
// looks like an obvious saving and cannot be one: to be safe it has to sit
// above what a single turn can charge (the worst turn on the ledger would have
// taken $23.78 of credits), and every balance in production is a daily refill
// target of $0.25 or $0.50 — the largest is $1.77. Any ceiling low enough to
// exclude somebody is low enough to wave through the runs that do the damage,
// so it would filter nothing while reading as though it filtered something.
// If sampling ever does cost too much, the cause will be total concurrency and
// the fix is to bound it, not to sort runs by their owner's balance.
