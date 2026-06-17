/**
 * Agent error extraction and classification.
 *
 * Agent CLIs report failures in many different JSON shapes. Historically each
 * parser hand-rolled a narrow extractor (e.g. `error.data.message || error.name
 * || "Unknown error"`) which silently collapsed any unrecognized shape to the
 * useless string "Unknown error" — discarding the real reason (auth failure,
 * insufficient balance, unavailable model, …) before it could ever reach the
 * user.
 *
 * This module centralizes two steps used by every parser's error branch:
 *
 *   1. extractErrorMessage() — pull the best human-readable string out of an
 *      arbitrary payload, falling back to a compact JSON dump so detail is
 *      *never* lost.
 *   2. classifyAgentError() — tag the message with a coarse category and append
 *      a short, actionable hint ("… — switch to a free model or add credits").
 *
 * resolveAgentError() composes both and additionally logs the raw payload when
 * nothing could be extracted, so a genuinely opaque error is still inspectable
 * in server logs.
 */

/** Coarse buckets a failure can fall into. Drives UI affordances downstream. */
export type AgentErrorCategory =
  | "auth"
  | "balance"
  | "model_unavailable"
  | "rate_limit"
  | "network"
  | "unknown"

export interface ClassifiedError {
  category: AgentErrorCategory
  /** User-facing message: the raw detail plus an actionable hint when known. */
  message: string
  /** The raw message that was classified (without the appended hint). */
  raw: string
}

/** JSON.stringify that never throws and caps length so logs/UI stay readable. */
function safeStringify(value: unknown, max = 600): string {
  try {
    const s = JSON.stringify(value)
    if (!s) return ""
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return ""
  }
}

/**
 * Best-effort extraction of a human-readable message from an arbitrary error
 * payload. Walks the field names agents commonly use, in priority order, and
 * as a last resort serializes the object so *something* concrete surfaces
 * instead of a generic placeholder. Returns "" only when there is genuinely
 * nothing to show.
 */
export function extractErrorMessage(input: unknown): string {
  if (input == null) return ""
  if (typeof input === "string") return input.trim()
  if (typeof input === "number" || typeof input === "boolean") {
    return String(input)
  }
  if (typeof input !== "object") return ""

  const e = input as Record<string, unknown>
  const nested = (key: string): Record<string, unknown> | undefined => {
    const v = e[key]
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
  }
  const data = nested("data")
  const error = nested("error")

  const candidates: unknown[] = [
    data?.message,
    e.message,
    error?.["data"] && typeof error["data"] === "object"
      ? (error["data"] as Record<string, unknown>).message
      : undefined,
    error?.message,
    typeof e.error === "string" ? e.error : undefined,
    e.finalError,
    e.detail,
    e.description,
    e.reason,
    e.name,
    error?.name,
    typeof e.code === "string" ? e.code : undefined,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim()
  }

  // Last resort: surface the raw object rather than hide it. For the failure
  // that motivated this module (an OpenCode `error` event carrying e.g.
  // `{ statusCode: 402 }` but no name/message) this yields the status code,
  // which classifyAgentError can then turn into a balance hint.
  const json = safeStringify(e)
  return json && json !== "{}" ? json : ""
}

/**
 * Order matters: the first rule whose pattern matches wins. Keep the more
 * specific / higher-signal categories above the broader ones.
 */
const RULES: { category: AgentErrorCategory; test: RegExp; hint: string }[] = [
  {
    category: "balance",
    test: /insufficient\s+(balance|credit|funds)|no\s+balance|out\s+of\s+(credit|balance)|payment\s+required|\b402\b|\bbilling\b/i,
    hint: "switch to a free model or add credits / an API key",
  },
  {
    category: "auth",
    test: /unauthor|invalid[\s_-]?api[\s_-]?key|invalid\s+key|authentication|forbidden|\b401\b|\b403\b|api\s+key[^.]*(missing|invalid|not\s+found)|no\s+api\s+key|permission\s+denied/i,
    hint: "check the API key for this model in Settings",
  },
  {
    category: "model_unavailable",
    test: /model[^.]*(not\s+found|not\s+available|unavailable|does\s+not\s+exist|unknown|invalid|no\s+such)|unsupported\s+model|no\s+such\s+model/i,
    hint: "select a different model for this agent",
  },
  {
    category: "rate_limit",
    test: /rate[\s_-]?limit|\b429\b|too\s+many\s+requests|overloaded/i,
    hint: "wait a moment and retry",
  },
  {
    category: "network",
    test: /econnrefused|etimedout|enotfound|socket\s+hang\s+up|fetch\s+failed|network\s+error|connection\s+(refused|reset|closed|error|failed)|\btimed?\s*out\b/i,
    hint: "check connectivity and retry",
  },
]

/**
 * Classify a raw error string and append a short actionable hint for known
 * categories. Unknown errors pass through unchanged (no hint), so we never
 * bury a precise provider message under a vague guess.
 */
export function classifyAgentError(raw: string): ClassifiedError {
  const text = (raw ?? "").trim()
  if (text) {
    for (const rule of RULES) {
      if (rule.test.test(text)) {
        return { category: rule.category, raw: text, message: `${text} — ${rule.hint}` }
      }
    }
  }
  return { category: "unknown", raw: text, message: text }
}

/**
 * Full pipeline used by parser error branches: extract the best message from an
 * arbitrary payload, classify it, and return the user-facing string. When
 * nothing can be extracted the raw payload is logged (so it is still
 * recoverable from server logs) and a clear placeholder is returned instead of
 * the old "Unknown error".
 */
export function resolveAgentError(input: unknown, provider?: string): string {
  const raw = extractErrorMessage(input)
  if (!raw) {
    console.error(
      `[${provider ?? "agent"}] error event had no extractable detail:`,
      safeStringify(input)
    )
    return "The agent reported an error without any details — check the agent logs."
  }
  return classifyAgentError(raw).message
}
