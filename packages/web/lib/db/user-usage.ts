import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { microToUsd } from "@/lib/server/credits"
import { providerLabel, type ProviderName } from "@background-agents/common"
import { NEW_REPOSITORY } from "@/lib/types"

// =============================================================================
// Per-user usage rollups for the Usage settings tab
// =============================================================================
// Two sources, deliberately not interchangeable:
//
//   Money  → CreditTransaction debits. This is what actually left the balance,
//            so the numbers here reconcile with the balance the user is shown.
//   Tokens → TokenUsage. Its `costUsd` is API list value, which at the current
//            pricing multipliers overstates what a turn cost the user by up to
//            20× for Claude — so it is never used as money here.
//
// A debit joins 1:1 to the usage row that caused it through `tokenUsageId`
// (unique), which is how spend gets attributed to a provider, model, repo or
// chat. Raw SQL because that column has no Prisma relation behind it, the same
// reason sumChatCreditsByProvider in lib/db/credits.ts uses it.

/** Ranges the Usage tab offers. */
export type UsageRange = "7d" | "30d" | "90d"

const RANGE_DAYS: Record<UsageRange, number> = { "7d": 7, "30d": 30, "90d": 90 }

/** Days covered by a range. */
function usageRangeDays(range: UsageRange): number {
  return RANGE_DAYS[range]
}

/** Parse the `range` query param, falling back for anything unrecognized. */
export function parseUsageRange(value: string | null, fallback: UsageRange): UsageRange {
  return value === "7d" || value === "30d" || value === "90d" ? value : fallback
}

/** What the daily chart stacks by. */
export type UsageDimension = "agent" | "model" | "repo" | "chat"

/** Parse the `dimension` query param, falling back for anything unrecognized. */
export function parseUsageDimension(value: string | null): UsageDimension {
  return value === "model" || value === "repo" || value === "chat" ? value : "agent"
}

/** What slice of the account the figures describe. */
export type UsageScope =
  | { kind: "account" }
  | { kind: "repo"; repo: string }
  | { kind: "chat"; chatId: string }

/**
 * Parse the `scope` query param: "account", "repo:<owner/name>" or
 * "chat:<id>". Anything unrecognized falls back to the whole account.
 *
 * No ownership check is needed here: every query filters on the caller's
 * userId, so a scope naming someone else's repo or chat matches no rows and
 * returns an empty window rather than leaking anything.
 */
export function parseUsageScope(value: string | null): UsageScope {
  if (!value || value === "account") return { kind: "account" }
  if (value.startsWith("repo:")) {
    const repo = value.slice(5)
    return repo ? { kind: "repo", repo } : { kind: "account" }
  }
  if (value.startsWith("chat:")) {
    const chatId = value.slice(5)
    return chatId ? { kind: "chat", chatId } : { kind: "account" }
  }
  return { kind: "account" }
}

/** Serialize a scope back into its query-param form. */
function formatUsageScope(scope: UsageScope): string {
  if (scope.kind === "repo") return `repo:${scope.repo}`
  if (scope.kind === "chat") return `chat:${scope.chatId}`
  return "account"
}

/**
 * The key everything past the top few is folded under.
 *
 * Must match OTHER_KEY in components/charts/palette.ts, which paints it grey:
 * the chart has eight validated colours and a ninth would be indistinguishable
 * from one of them under colour-vision deficiency.
 */
const OTHER_SERIES_KEY = "__other__"

/** How many real series a chart draws before the tail becomes "Other". */
const MAX_SERIES = 8

/** One day of the series, keyed by whatever dimension is being stacked. */
export interface UsageDayPoint {
  /** Calendar day, YYYY-MM-DD, in UTC. */
  date: string
  /** Credits debited that day, per series key, in USD. */
  credits: Record<string, number>
  /** Tokens recorded that day, per series key. */
  tokens: Record<string, number>
}

/** Headline figures, each alongside the preceding window of equal length. */
export interface UsageTotals {
  creditsUsd: number
  prevCreditsUsd: number
  tokens: number
  prevTokens: number
  turns: number
  prevTurns: number
}

/** One stacked series: an agent, model, repo or chat, with its window totals. */
export interface UsageSeries {
  /** Provider name, model id, "owner/repo", a chat id, or OTHER_SERIES_KEY. */
  key: string
  label: string
  creditsUsd: number
  tokens: number
  turns: number
}

/** An entry the scope picker can offer. */
export interface UsageScopeOption {
  key: string
  label: string
}

export interface UserUsageSummary {
  range: UsageRange
  scope: string
  dimension: UsageDimension
  totals: UsageTotals
  daily: UsageDayPoint[]
  /** Series to stack, ranked, already folded to at most MAX_SERIES + "Other". */
  series: UsageSeries[]
  /** Everything the scope picker can offer — always the whole account, so the
   *  picker can still get back out of a scope it is currently inside. */
  scopeOptions: { repos: UsageScopeOption[]; chats: UsageScopeOption[] }
}

/** YYYY-MM-DD for a Date, in UTC — the key the daily series is built on. */
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Every calendar day in the window, oldest first, so quiet days render as gaps
 * in the chart rather than disappearing and compressing the time axis.
 */
function denseDays(days: number): string[] {
  const out: string[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    out.push(dayKey(d))
  }
  return out
}

/**
 * Display name for a chat, with a date appended when it has no title.
 *
 * Untitled chats are common and otherwise identical, which makes a list of
 * them impossible to pick from. The date is a disambiguator rather than a
 * precise timestamp, so it is formatted in UTC with a pinned locale: the
 * point is that two rows differ, and that has to be deterministic regardless
 * of where the server runs.
 */
function chatLabel(displayName: string | null | undefined, createdAt: Date | null): string {
  if (displayName) return displayName
  if (!createdAt) return "Untitled chat"
  const day = createdAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
  return `Untitled chat · ${day}`
}

/** Display name for a repo slug, including the "no repo yet" placeholder. */
function repoLabel(repo: string): string {
  return repo === NEW_REPOSITORY ? "No repository" : repo
}

/** Rows as the ranking query returns them, before labelling. */
interface RawSeriesRow {
  key: string | null
  label?: string | null
  createdAt?: Date | null
  tokens: bigint
  turns: bigint
  micro: bigint
}

/**
 * Everything the Usage tab needs for one user, window, scope and dimension.
 *
 * The dimension is a server parameter rather than four parallel rollups: only
 * one is on screen at a time, and the client caches each per key, so switching
 * costs one query the first time and nothing after.
 *
 * Each total query covers twice the window so the preceding period comes back
 * in the same pass, splitting on the boundary with a CASE rather than paying
 * for a second round trip per figure.
 */
export async function getUserUsageSummary(
  userId: string,
  range: UsageRange,
  scope: UsageScope = { kind: "account" },
  dimension: UsageDimension = "agent"
): Promise<UserUsageSummary> {
  const days = usageRangeDays(range)
  const interval = `${days} days`
  const doubleInterval = `${days * 2} days`

  // The scope narrows on chat id, which both ledgers carry — so it never needs
  // a join, and a repo resolves to its chats through a subquery rather than
  // dragging Chat into every aggregate.
  const chatsInRepo = (repo: string) =>
    Prisma.sql`(SELECT "id" FROM "Chat" WHERE "userId" = ${userId} AND "repo" = ${repo})`
  const scopeOn = (column: Prisma.Sql) => {
    if (scope.kind === "repo") return Prisma.sql`AND ${column} IN ${chatsInRepo(scope.repo)}`
    if (scope.kind === "chat") return Prisma.sql`AND ${column} = ${scope.chatId}`
    return Prisma.empty
  }
  const scopeTu = scopeOn(Prisma.sql`tu."chatId"`)
  const scopeUsage = scopeOn(Prisma.sql`"chatId"`)
  const scopeLedger = scopeOn(Prisma.sql`"chatId"`)

  // Repo and chat live on Chat, the other two on TokenUsage — so only those two
  // dimensions pay for the join.
  const needsChat = dimension === "repo" || dimension === "chat"
  const chatJoin = needsChat
    ? Prisma.sql`JOIN "Chat" c ON c."id" = tu."chatId"`
    : Prisma.empty
  const keyExpr =
    dimension === "agent"
      ? Prisma.sql`tu."provider"`
      : dimension === "model"
        ? Prisma.sql`tu."model"`
        : dimension === "repo"
          ? Prisma.sql`c."repo"`
          : Prisma.sql`tu."chatId"`
  // Chats need their title to be readable; the others are their own label.
  const labelCols = dimension === "chat"
    ? Prisma.sql`, c."displayName" AS label, c."createdAt" AS "createdAt"`
    : Prisma.empty
  // Grouped by expression, not by ordinal: the select list interleaves
  // aggregates with these label columns, so a positional GROUP BY silently
  // points at SUM()/COUNT() and Postgres rejects the whole query.
  const labelGroupBy = dimension === "chat"
    ? Prisma.sql`, c."displayName", c."createdAt"`
    : Prisma.empty

  // Joining the ledger onto usage is safe because CreditTransaction.tokenUsageId
  // is unique: at most one debit per usage row, so tokens can't be doubled.
  const ledgerJoin = Prisma.sql`
    LEFT JOIN "CreditTransaction" ct
           ON ct."tokenUsageId" = tu."id" AND ct."type" = 'debit'`
  const usageWindow = Prisma.sql`
    tu."userId" = ${userId} AND tu."createdAt" >= NOW() - ${interval}::interval`

  const [creditTotals, tokenTotals, seriesRows, creditsByDay, tokensByDay] = await Promise.all([
    prisma.$queryRaw<Array<{ cur: bigint | null; prev: bigint | null }>>`
      SELECT
        SUM(CASE WHEN "createdAt" >= NOW() - ${interval}::interval
                 THEN -"amountMicroUsd" ELSE 0 END)::bigint AS cur,
        SUM(CASE WHEN "createdAt" <  NOW() - ${interval}::interval
                 THEN -"amountMicroUsd" ELSE 0 END)::bigint AS prev
      FROM "CreditTransaction"
      WHERE "userId" = ${userId}
        AND "type" = 'debit'
        AND "createdAt" >= NOW() - ${doubleInterval}::interval
        ${scopeLedger}
    `,
    prisma.$queryRaw<
      Array<{ cur: bigint | null; prev: bigint | null; curTurns: bigint; prevTurns: bigint }>
    >`
      SELECT
        SUM(CASE WHEN "createdAt" >= NOW() - ${interval}::interval
                 THEN "totalTokens" ELSE 0 END)::bigint AS cur,
        SUM(CASE WHEN "createdAt" <  NOW() - ${interval}::interval
                 THEN "totalTokens" ELSE 0 END)::bigint AS prev,
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - ${interval}::interval)::bigint AS "curTurns",
        COUNT(*) FILTER (WHERE "createdAt" <  NOW() - ${interval}::interval)::bigint AS "prevTurns"
      FROM "TokenUsage"
      WHERE "userId" = ${userId}
        AND "createdAt" >= NOW() - ${doubleInterval}::interval
        ${scopeUsage}
    `,
    // The ranking, which decides both stacking order and what gets folded away.
    prisma.$queryRaw<RawSeriesRow[]>`
      SELECT ${keyExpr} AS key,
             SUM(tu."totalTokens")::bigint AS tokens,
             COUNT(*)::bigint AS turns,
             COALESCE(SUM(-ct."amountMicroUsd"), 0)::bigint AS micro
             ${labelCols}
        FROM "TokenUsage" tu ${chatJoin} ${ledgerJoin}
       WHERE ${usageWindow} ${scopeTu}
       GROUP BY ${keyExpr} ${labelGroupBy}
       ORDER BY micro DESC, tokens DESC
       LIMIT 200
    `,
    prisma.$queryRaw<Array<{ day: Date; key: string | null; micro: bigint }>>`
      SELECT date_trunc('day', ct."createdAt")::date AS day,
             ${keyExpr} AS key,
             SUM(-ct."amountMicroUsd")::bigint AS micro
        FROM "CreditTransaction" ct
        JOIN "TokenUsage" tu ON tu."id" = ct."tokenUsageId"
        ${chatJoin}
       WHERE ct."userId" = ${userId}
         AND ct."type" = 'debit'
         AND ct."createdAt" >= NOW() - ${interval}::interval
         ${scopeTu}
       GROUP BY 1, 2
    `,
    prisma.$queryRaw<Array<{ day: Date; key: string | null; tokens: bigint }>>`
      SELECT date_trunc('day', tu."createdAt")::date AS day,
             ${keyExpr} AS key,
             SUM(tu."totalTokens")::bigint AS tokens
        FROM "TokenUsage" tu ${chatJoin}
       WHERE ${usageWindow} ${scopeTu}
       GROUP BY 1, 2
    `,
  ])

  // Label each ranked key once, here, so the client never has to know that a
  // repo slug, a model id and a chat title are labelled differently.
  const labelFor = (row: RawSeriesRow): string => {
    const key = row.key ?? ""
    if (dimension === "agent") return providerLabel(key as ProviderName)
    if (dimension === "model") return key || "Unknown model"
    if (dimension === "repo") return repoLabel(key)
    return chatLabel(row.label, row.createdAt ?? null)
  }

  const ranked = seriesRows.filter((r) => Number(r.tokens) > 0 || r.micro > 0n)
  const top = ranked.slice(0, MAX_SERIES)
  const topKeys = new Set(top.map((r) => r.key ?? ""))
  const tail = ranked.slice(MAX_SERIES)

  const series: UsageSeries[] = top.map((row) => ({
    key: row.key ?? "",
    label: labelFor(row),
    creditsUsd: microToUsd(row.micro),
    tokens: Number(row.tokens),
    turns: Number(row.turns),
  }))
  if (tail.length > 0) {
    series.push({
      key: OTHER_SERIES_KEY,
      label: `Other (${tail.length})`,
      creditsUsd: tail.reduce((acc, r) => acc + microToUsd(r.micro), 0),
      tokens: tail.reduce((acc, r) => acc + Number(r.tokens), 0),
      turns: tail.reduce((acc, r) => acc + Number(r.turns), 0),
    })
  }

  // Index the grouped rows by day so the dense series can be filled in one
  // pass. The grouping itself is SQL's job; this only densifies a result
  // bounded by the window length times the key count, and folds the tail.
  const creditsIndex = new Map<string, Record<string, number>>()
  const tokensIndex = new Map<string, Record<string, number>>()
  const bucketKey = (key: string | null) => {
    const k = key ?? ""
    return topKeys.has(k) ? k : OTHER_SERIES_KEY
  }
  const add = (
    index: Map<string, Record<string, number>>,
    day: Date,
    key: string | null,
    value: number
  ) => {
    const date = dayKey(day)
    const bucket = index.get(date) ?? {}
    const k = bucketKey(key)
    bucket[k] = (bucket[k] ?? 0) + value
    index.set(date, bucket)
  }

  for (const row of creditsByDay) add(creditsIndex, row.day, row.key, microToUsd(row.micro))
  for (const row of tokensByDay) add(tokensIndex, row.day, row.key, Number(row.tokens))

  const daily: UsageDayPoint[] = denseDays(days).map((date) => ({
    date,
    credits: creditsIndex.get(date) ?? {},
    tokens: tokensIndex.get(date) ?? {},
  }))

  // The picker has to list what the account has, not what the current scope
  // has — otherwise scoping into a chat would empty the very control needed to
  // scope back out.
  const scopeOptions = await getScopeOptions(userId, interval)

  return {
    range,
    scope: formatUsageScope(scope),
    dimension,
    totals: {
      creditsUsd: microToUsd(creditTotals[0]?.cur ?? 0n),
      prevCreditsUsd: microToUsd(creditTotals[0]?.prev ?? 0n),
      tokens: Number(tokenTotals[0]?.cur ?? 0n),
      prevTokens: Number(tokenTotals[0]?.prev ?? 0n),
      turns: Number(tokenTotals[0]?.curTurns ?? 0n),
      prevTurns: Number(tokenTotals[0]?.prevTurns ?? 0n),
    },
    daily,
    series,
    scopeOptions,
  }
}

/** Account-wide repos and chats with activity in the window, for the picker. */
async function getScopeOptions(
  userId: string,
  interval: string
): Promise<{ repos: UsageScopeOption[]; chats: UsageScopeOption[] }> {
  const [repos, chats] = await Promise.all([
    prisma.$queryRaw<Array<{ key: string; weight: bigint }>>`
      SELECT c."repo" AS key, SUM(tu."totalTokens")::bigint AS weight
        FROM "TokenUsage" tu
        JOIN "Chat" c ON c."id" = tu."chatId"
       WHERE tu."userId" = ${userId} AND tu."createdAt" >= NOW() - ${interval}::interval
       GROUP BY 1
       ORDER BY weight DESC
       LIMIT 50
    `,
    prisma.$queryRaw<
      Array<{ key: string; label: string | null; createdAt: Date | null; weight: bigint }>
    >`
      SELECT tu."chatId" AS key, c."displayName" AS label,
             c."createdAt" AS "createdAt",
             SUM(tu."totalTokens")::bigint AS weight
        FROM "TokenUsage" tu
        JOIN "Chat" c ON c."id" = tu."chatId"
       WHERE tu."userId" = ${userId} AND tu."createdAt" >= NOW() - ${interval}::interval
       GROUP BY 1, 2, 3
       ORDER BY weight DESC
       LIMIT 50
    `,
  ])
  return {
    repos: repos.map((r) => ({ key: r.key, label: repoLabel(r.key) })),
    chats: chats.map((c) => ({ key: c.key, label: chatLabel(c.label, c.createdAt) })),
  }
}
