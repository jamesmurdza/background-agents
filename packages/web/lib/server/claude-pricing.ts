/**
 * First-party Claude token pricing.
 *
 * The shared Claude pool is budgeted in USD, so the dollar figure that gates a
 * user has to be one we can defend. tokscale reports a cost of its own, but it
 * derives it from LiteLLM's price table fetched over the network at run time
 * (falling back to models.dev / OpenRouter), keyed by whatever model id the CLI
 * happened to write. A miss there is silent and yields $0 — i.e. an unmetered
 * turn. So for the Claude pool we price the turn ourselves from the token
 * counts tokscale reports, using Anthropic's published rates, and fall back to
 * tokscale's cost only for models we don't recognise.
 *
 * Rates: https://platform.claude.com/docs/en/about-claude/pricing (checked
 * 2026-11-13). Only base input and output are listed per model. Cache writes
 * are a fixed multiple of base input on every model:
 *   5-minute cache write  1.25× input
 *   1-hour cache write    2×    input
 * Cache reads (hits) are 0.1× input on most models, but the 5.x-generation
 * models use a lower multiplier instead — see `cacheReadMultiplier` below.
 *
 * Not modelled (none of it applies to a Claude Code turn on the shared pool):
 * batch discounts, the `inference_geo: "us"` 1.1× multiplier, fast mode, and
 * server-side tool surcharges such as web search.
 */

/** USD per million tokens, base rates. Cache write rates derive from `input`. */
interface ClaudeRate {
  input: number
  output: number
  /**
   * Cache-read (hit) price as a multiple of base `input`. Defaults to
   * {@link CACHE_READ_MULTIPLIER} (0.1) when unset — only the 5.x-generation
   * models publish a different multiplier.
   */
  cacheReadMultiplier?: number
  /**
   * Haiku 5.5 only: once a request's prompt (input + cache-read +
   * cache-write tokens) exceeds `threshold`, the whole request — input,
   * output, and the cache multiplier above applies to this tier's `input`
   * too — is billed at this rate instead of the base one.
   */
  longContext?: {
    threshold: number
    input: number
    output: number
  }
}

/** Cache-write price as a multiple of base input (5-minute TTL). */
const CACHE_WRITE_5M_MULTIPLIER = 1.25
/** Default cache-read (hit) price as a multiple of base input. */
const CACHE_READ_MULTIPLIER = 0.1

/**
 * Rates keyed by `<family>-<version>`, the normalized form produced by
 * {@link normalizeClaudeModel}. Retired models are kept because old sessions
 * can still be metered against them.
 */
const CLAUDE_RATES: Record<string, ClaudeRate> = {
  "fable-5.2": { input: 8, output: 40, cacheReadMultiplier: 0.025 },
  "mythos-5.2": { input: 8, output: 40, cacheReadMultiplier: 0.025 },
  "fable-5.1": { input: 10, output: 50, cacheReadMultiplier: 0.025 },
  "mythos-5.1": { input: 10, output: 50, cacheReadMultiplier: 0.025 },
  "fable-5": { input: 10, output: 50 },
  "mythos-5": { input: 10, output: 50 },
  "opus-5.5": { input: 4, output: 20, cacheReadMultiplier: 0.05 },
  "opus-5": { input: 5, output: 25 },
  "opus-4.8": { input: 5, output: 25 },
  "opus-4.7": { input: 5, output: 25 },
  "opus-4.6": { input: 5, output: 25 },
  "opus-4.5": { input: 5, output: 25 },
  "opus-4.1": { input: 15, output: 75 },
  "opus-4": { input: 15, output: 75 },
  "sonnet-5.5": { input: 2, output: 10, cacheReadMultiplier: 0.05 },
  "sonnet-5": { input: 2, output: 10 },
  "sonnet-4.6": { input: 3, output: 15 },
  "sonnet-4.5": { input: 3, output: 15 },
  "sonnet-4": { input: 3, output: 15 },
  "haiku-5.5": {
    input: 0.1,
    output: 0.5,
    longContext: { threshold: 100_000, input: 0.5, output: 2.5 },
  },
  "haiku-4.5": { input: 1, output: 5 },
  "haiku-3.5": { input: 0.8, output: 4 },
}

/** Model families we price. */
const FAMILIES = "opus|sonnet|haiku|fable|mythos"

/**
 * A version is one or two dot/dash-separated parts of at most two digits each
 * (`5`, `4-5`, `4.8`). The trailing `(?!\d)` stops the optional minor part from
 * swallowing the leading digits of a release date: in `sonnet-5-20260101` it
 * forces a backtrack to just `5`.
 */
const VERSION = "(\\d{1,2}(?:[-.]\\d{1,2})?)(?!\\d)"
/** Current id shape: `claude-opus-4-5`, `claude-sonnet-5-20260101`, … */
const MODERN = new RegExp(`claude[-_.]?(${FAMILIES})[-_.]${VERSION}`)
/** Legacy id shape, version before family: `claude-3-5-haiku-20241022`. */
const LEGACY = new RegExp(`claude[-_.]${VERSION}[-_.](${FAMILIES})`)

/**
 * Reduce a model id to a `<family>-<version>` pricing key, or null when it
 * isn't a Claude model we price.
 *
 * Absorbs the shapes a session file can carry: vendor prefixes
 * (`anthropic/`, `us.anthropic.`), a trailing release date
 * (`-20251101`), Bedrock's `-v1:0` suffix, `4-5` vs `4.5` version separators,
 * and the pre-4.x ordering (`claude-3-5-haiku`). Suffixes the price doesn't
 * depend on (`-thinking`, `-latest`) fall out for free — the version is read
 * from the first match, and anything after it is ignored.
 */
export function normalizeClaudeModel(model: string | null | undefined): string | null {
  if (!model) return null
  const id = model.toLowerCase()
  const m = MODERN.exec(id)
  if (m) return `${m[1]}-${m[2].replace("-", ".")}`
  const l = LEGACY.exec(id)
  if (l) return `${l[2]}-${l[1].replace("-", ".")}`
  return null
}

/** Token counts for one turn, as reported by tokscale. */
export interface ClaudeTokenCounts {
  /** Uncached input tokens. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Extended-thinking tokens, when a client reports them separately. */
  reasoningTokens: number
}

/**
 * Price one turn in USD, or null when the model isn't a Claude model we have
 * rates for (caller should then fall back to tokscale's own figure).
 *
 * These are Anthropic's first-party rates, so only call this for a run actually
 * served by Anthropic. A Claude model reached through a reseller (OpenCode,
 * Kilo, a custom endpoint) is priced by that reseller, not by this table.
 *
 * Cache writes are billed at the 5-minute rate: Claude Code's cache breakpoints
 * are ephemeral 5m by default, and tokscale reports a single cache-write count
 * with no TTL, so there's nothing to distinguish a 1-hour write by. That makes
 * this a slight under-estimate for a session that opts into 1h caching.
 *
 * Reasoning tokens are billed at the output rate — Anthropic bills extended
 * thinking as output. Claude Code folds thinking into `output_tokens` and
 * reports no separate reasoning count, so this term is 0 for the shared pool;
 * it exists for clients that do split the two.
 *
 * Haiku 5.5 prices by prompt length (input + cache-read + cache-write
 * tokens): a request whose prompt exceeds the `longContext` threshold is
 * billed entirely at the higher tier, including its cache rates. Every other
 * model ignores `longContext` and uses its base rate regardless of size.
 */
export function priceClaudeTurn(
  model: string | null | undefined,
  tokens: ClaudeTokenCounts
): number | null {
  const key = normalizeClaudeModel(model)
  if (!key) return null
  const rate = CLAUDE_RATES[key]
  if (!rate) return null

  const promptTokens = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
  const tier =
    rate.longContext && promptTokens > rate.longContext.threshold ? rate.longContext : rate
  const cacheReadMultiplier = rate.cacheReadMultiplier ?? CACHE_READ_MULTIPLIER

  const perToken = (usdPerMillion: number, count: number) =>
    (usdPerMillion * count) / 1_000_000

  return (
    perToken(tier.input, tokens.inputTokens) +
    perToken(tier.output, tokens.outputTokens) +
    perToken(tier.output, tokens.reasoningTokens) +
    perToken(tier.input * cacheReadMultiplier, tokens.cacheReadTokens) +
    perToken(tier.input * CACHE_WRITE_5M_MULTIPLIER, tokens.cacheWriteTokens)
  )
}
