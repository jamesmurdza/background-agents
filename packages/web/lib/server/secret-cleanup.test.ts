/**
 * Unit tests for sweeping unused Daytona secrets.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import type { Daytona } from "@daytonaio/sdk"

const db = vi.hoisted(() => ({
  credentials: vi.fn(),
  userFindMany: vi.fn(),
}))

vi.mock("@/lib/db/api-helpers", () => ({ getUserCredentials: db.credentials }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findMany: db.userFindMany } } }))

import { REVERIFY_MS, encodeMounts, stampLastUsed, toSecretMarker } from "@background-agents/sandbox-secrets"
import { SHARED_KEY_POOLS, secretNameForKey } from "./shared-key-pools"
import { CLAUDE_SHARED_SECRET_PREFIX, claudeOwnSecretPrefix, codexSecretPrefix } from "./subscription-secrets"
import { PINNED_SECRETS_LABEL, TURN_SECRETS_LABEL } from "./turn-secrets"
import { userKeySecretName, userKeySecretPrefix, userSecretTag } from "./user-key-secrets"
import {
  GRACE_MS,
  UNUSED_MS,
  cleanupSecrets,
  loadUserSecretState,
  planSecretCleanup,
  type ListedSecret,
  type UserSecretState,
} from "./secret-cleanup"

const NOW = Date.UTC(2026, 9, 28, 12)
const OLD = NOW - 2 * GRACE_MS
const old = (name: string, ageMs = 0): ListedSecret => ({ id: `id_${name}`, name, createdAt: OLD - ageMs, lastUsedAt: OLD - ageMs })
/** Created long ago, last used `usedAgoMs` ago. */
const used = (name: string, usedAgoMs: number): ListedSecret => ({
  id: `id_${name}`,
  name,
  createdAt: NOW - 30 * UNUSED_MS,
  lastUsedAt: NOW - usedAgoMs,
})

const USER = "user-1"
const TAG = userSecretTag(USER)

beforeEach(() => {
  process.env.OPENCODE_API_KEY = "oc-key-1"
  process.env.DAYTONA_USER_KEY_SECRETS = "all,CODEX_CREDENTIALS,CLAUDE_SHARED"
  db.credentials.mockReset().mockResolvedValue({})
  db.userFindMany.mockReset().mockResolvedValue([])
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.OPENCODE_API_KEY
  delete process.env.DAYTONA_USER_KEY_SECRETS
  vi.restoreAllMocks()
})

describe("planSecretCleanup", () => {
  const plan = (
    secrets: ListedSecret[],
    users = new Map<string, UserSecretState | "unknown">(),
    mounted = new Set<string>()
  ) => planSecretCleanup(secrets, users, NOW, mounted)
  const doomedNames = (secrets: ListedSecret[], users?: Map<string, UserSecretState | "unknown">) =>
    plan(secrets, users).doomed.map((s) => s.name)

  it("deletes pool secrets for keys no longer configured, and the hand-made ones", () => {
    const current = secretNameForKey(SHARED_KEY_POOLS.opencode, "oc-key-1")
    const removed = secretNameForKey(SHARED_KEY_POOLS.opencode, "oc-key-gone")
    expect(doomedNames([old(current), old(removed), old("OPENCODE_API_KEY_1"), old("OPENCODE_API_KEY_2")])).toEqual([
      removed,
      "OPENCODE_API_KEY_1",
      "OPENCODE_API_KEY_2",
    ])
  })

  it("doesn't judge a pool with no keys configured here by name, only by use", () => {
    const gemini = secretNameForKey(SHARED_KEY_POOLS.gemini, "g-key")
    expect(plan([old(gemini)])).toMatchObject({ doomed: [], ignored: 0 })
    expect(doomedNames([used(gemini, UNUSED_MS)])).toEqual([gemini])
  })

  it("keeps the newest two shared Claude secrets, or none when that's off", () => {
    const secrets = [0, 1, 2].map((i) => old(`${CLAUDE_SHARED_SECRET_PREFIX}${i}`, i * 1000))
    expect(doomedNames(secrets)).toEqual([`${CLAUDE_SHARED_SECRET_PREFIX}2`])
    process.env.DAYTONA_USER_KEY_SECRETS = "ANTHROPIC_API_KEY"
    expect(doomedNames(secrets)).toHaveLength(3)
  })

  it("deletes every secret of a user who is gone", () => {
    const name = userKeySecretName("gone-user", "OPENAI_API_KEY", "sk")
    expect(doomedNames([old(name)])).toEqual([name])
  })

  it("keeps what a user's settings would create, and their newest two Codex tokens", () => {
    const keep = userKeySecretName(USER, "OPENAI_API_KEY", "sk-now")
    const stale = userKeySecretName(USER, "OPENAI_API_KEY", "sk-before")
    const codex = [0, 1, 2].map((i) => old(`${codexSecretPrefix(USER)}${i}`, i * 1000))
    const users = new Map([[TAG, { expected: new Set([keep]), tokenPrefixes: [codexSecretPrefix(USER)] }]])
    expect(doomedNames([old(keep), old(stale), ...codex], users)).toEqual([stale, `${codexSecretPrefix(USER)}2`])
  })

  it("keeps a user's newest two own Claude tokens beside their Codex ones", () => {
    const prefixes = [codexSecretPrefix(USER), claudeOwnSecretPrefix(USER)]
    const claude = [0, 1, 2].map((i) => old(`${prefixes[1]}${i}`, i * 1000))
    const codex = [old(`${prefixes[0]}0`)]
    const users = new Map([[TAG, { expected: new Set<string>(), tokenPrefixes: prefixes }]])
    expect(doomedNames([...claude, ...codex], users)).toEqual([`${prefixes[1]}2`])
  })

  it("judges a user whose settings couldn't be loaded by use only", () => {
    const name = userKeySecretName(USER, "OPENAI_API_KEY", "sk")
    const users = new Map<string, UserSecretState | "unknown">([[TAG, "unknown"]])
    expect(plan([old(name)], users)).toMatchObject({ doomed: [] })
    expect(doomedNames([used(name, UNUSED_MS)], users)).toEqual([name])
  })

  it("deletes any of ours unused for a day, even one its owner's settings still need", () => {
    const current = secretNameForKey(SHARED_KEY_POOLS.opencode, "oc-key-1")
    const keep = userKeySecretName(USER, "OPENAI_API_KEY", "sk-now")
    const users = new Map([[TAG, { expected: new Set([keep]), tokenPrefixes: [] }]])
    expect(doomedNames([used(current, UNUSED_MS), used(keep, UNUSED_MS + 1)], users)).toEqual([current, keep])
    expect(doomedNames([used(current, UNUSED_MS - 1), used(keep, REVERIFY_MS)], users)).toEqual([])
  })

  it("never deletes what a sandbox has mounted, however idle or unneeded", () => {
    const removed = secretNameForKey(SHARED_KEY_POOLS.opencode, "oc-key-gone")
    const result = plan([used(removed, 5 * UNUSED_MS), old("OPENCODE_API_KEY_1")], undefined, new Set([removed, "OPENCODE_API_KEY_1"]))
    expect(result).toMatchObject({ doomed: [], mounted: 2 })
  })

  it("ignores secrets this app didn't create, however idle", () => {
    expect(plan([used("someone_elses_secret", 30 * UNUSED_MS)])).toEqual({ doomed: [], young: 0, mounted: 0, ignored: 1 })
  })

  it("never deletes anything newer than the grace period, or not ours", () => {
    const young = { ...old("OPENCODE_API_KEY_1"), createdAt: NOW - GRACE_MS / 2 }
    expect(plan([young, old("someone_elses_secret"), old("BA_VERIFY_x")])).toEqual({ doomed: [], young: 1, mounted: 0, ignored: 2 })
  })
})

describe("loadUserSecretState", () => {
  it("expects the names the user's keys create", async () => {
    db.credentials.mockResolvedValue({
      OPENAI_API_KEY: "sk-own",
      OPENCODE_API_KEY: toSecretMarker("opencode_abc"), // a pool's: not the user's
      CODEX_CREDENTIALS: "{}",
    })

    const state = await loadUserSecretState(USER)
    expect([...state.expected]).toEqual([userKeySecretName(USER, "OPENAI_API_KEY", "sk-own")])
    expect(state.tokenPrefixes).toEqual([codexSecretPrefix(USER)])
  })

  it("expects nothing a feature that's off would create", async () => {
    process.env.DAYTONA_USER_KEY_SECRETS = ""
    db.credentials.mockResolvedValue({ OPENAI_API_KEY: "sk-own", CODEX_CREDENTIALS: "{}" })
    const state = await loadUserSecretState(USER)
    expect(state).toEqual({ expected: new Set(), tokenPrefixes: [] })
  })
})

describe("cleanupSecrets", () => {
  function fakeDaytona(names: string[], sandboxLabels: Record<string, string>[] = []) {
    // Created two hours ago and stamped as used then.
    const items = names.map((name) => ({
      id: `id_${name}`,
      name,
      createdAt: new Date(Date.now() - 2 * GRACE_MS).toISOString(),
      description: stampLastUsed("d", Date.now() - 2 * GRACE_MS),
    }))
    const secret = {
      list: vi.fn().mockResolvedValue({ items, nextCursor: null }),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const list = vi.fn(async function* () {
      for (const labels of sandboxLabels) yield { labels }
    })
    return { secret, daytona: { secret, list } as unknown as Daytona }
  }

  const stale = userKeySecretName(USER, "OPENAI_API_KEY", "sk-before")
  const gone = `${userKeySecretPrefix("gone-user")}x`

  it("reports what it would delete in a dry run, deleting nothing", async () => {
    db.userFindMany.mockResolvedValue([{ id: USER }])
    const { secret, daytona } = fakeDaytona([stale, gone, "not_ours"])
    const report = await cleanupSecrets(daytona, { dryRun: true })
    expect(report).toEqual({ dryRun: true, scanned: 3, deleted: [stale, gone], young: 0, mounted: 0, ignored: 1, errors: 0 })
    expect(secret.delete).not.toHaveBeenCalled()
  })

  it("deletes, counting failures without stopping", async () => {
    db.userFindMany.mockResolvedValue([{ id: USER }])
    const { secret, daytona } = fakeDaytona([stale, gone])
    secret.delete.mockRejectedValueOnce(new Error("500"))
    const report = await cleanupSecrets(daytona, { dryRun: false })
    expect(report).toMatchObject({ deleted: [gone], errors: 1 })
    expect(secret.delete.mock.calls).toEqual([[`id_${stale}`], [`id_${gone}`]])
  })

  it("leaves a user's recently used secrets alone when their settings fail to load", async () => {
    db.userFindMany.mockResolvedValue([{ id: USER }])
    db.credentials.mockRejectedValue(new Error("db down"))
    const { daytona } = fakeDaytona([stale])
    expect(await cleanupSecrets(daytona, { dryRun: false })).toMatchObject({ deleted: [] })
  })

  it("keeps whatever any sandbox's labels say is mounted, the pinned ones included", async () => {
    db.userFindMany.mockResolvedValue([{ id: USER }])
    const { secret, daytona } = fakeDaytona(
      [stale, gone, "OPENCODE_API_KEY_1"],
      [
        { [TURN_SECRETS_LABEL]: encodeMounts({ USER_KEY_OPENAI_API_KEY: stale }) },
        { [TURN_SECRETS_LABEL]: "none", [PINNED_SECRETS_LABEL]: encodeMounts({ K: gone }) },
        { [TURN_SECRETS_LABEL]: "OPENCODE_API_KEY_1" }, // label from before mount sets
        {},
      ]
    )
    expect(await cleanupSecrets(daytona, { dryRun: false })).toMatchObject({ deleted: [], mounted: 3 })
    expect(secret.delete).not.toHaveBeenCalled()
  })

  it("only looks users up when there are user secrets", async () => {
    const { daytona } = fakeDaytona(["OPENCODE_API_KEY_1"])
    await cleanupSecrets(daytona, { dryRun: true })
    expect(db.userFindMany).not.toHaveBeenCalled()
  })
})
