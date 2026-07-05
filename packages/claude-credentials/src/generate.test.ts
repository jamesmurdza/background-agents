/**
 * Tests for the snapshot-lifecycle helpers that keep credential refresh working
 * after Daytona garbage-collects (prunes) the backing image of a previously
 * built snapshot.
 *
 * The bug these guard against: passing an inline `Image` to `daytona.create()`
 * registers an anonymous, prunable snapshot. Once pruned, later runs fail with
 * "pull access denied ... repository does not exist" and never self-heal. We
 * switched to a *named* snapshot that ensureCCAuthSnapshot can look up and
 * deterministically rebuild.
 */
import { describe, it, expect } from "vitest"
import type { Image } from "@daytonaio/sdk"
import { ensureCCAuthSnapshot, getCCAuthSnapshotName } from "./generate"

type FakeState =
  | "active"
  | "building"
  | "pending"
  | "pulling"
  | "error"
  | "build_failed"
  | "removing"

/**
 * Minimal stand-in for the pieces of the Daytona SDK that ensureCCAuthSnapshot
 * touches: `snapshot.get` / `snapshot.delete` / `snapshot.create`. It records
 * every call so tests can assert on the sequence of decisions.
 */
function makeFakeDaytona(opts: {
  /** Initial snapshot state, or undefined to simulate "not found". */
  initial?: FakeState
  /** State to report after a (re)build completes. Defaults to "active". */
  afterCreate?: FakeState
  /**
   * Model Daytona's asynchronous deletion: delete() moves the snapshot to
   * `removing` and it lingers there for this many get() reads before the name
   * frees up. 0 (default) = synchronous delete.
   */
  removingReads?: number
  /** Number of initial create() calls that throw a 409 "already exists". */
  conflictOnCreate?: number
}) {
  const calls: string[] = []
  let state: FakeState | undefined = opts.initial
  let removingLeft = 0
  let conflictsLeft = opts.conflictOnCreate ?? 0

  const snapshot = {
    async get(name: string) {
      // Consume the `removing` lifetime, then the name frees up.
      if (state === "removing") {
        if (removingLeft > 0) removingLeft--
        if (removingLeft === 0) state = undefined
      }
      calls.push(`get:${state ?? "missing"}`)
      if (state === undefined) {
        throw new Error(`Snapshot ${name} not found (404)`)
      }
      return { id: `id-${name}`, name, state }
    },
    async delete(_snap: { id: string }) {
      calls.push(`delete`)
      if (opts.removingReads && opts.removingReads > 0) {
        state = "removing"
        removingLeft = opts.removingReads
      } else {
        state = undefined
      }
    },
    async create({ name }: { name: string }) {
      calls.push(`create`)
      if (conflictsLeft > 0) {
        conflictsLeft--
        const err = new Error(
          `Snapshot with name "${name}" already exists for this organization`,
        ) as Error & { statusCode?: number }
        err.statusCode = 409
        throw err
      }
      state = opts.afterCreate ?? "active"
      return { id: `id-${name}`, name, state }
    },
  }

  return { daytona: { snapshot }, calls, getState: () => state }
}

const fakeImage = {} as Image

describe("getCCAuthSnapshotName", () => {
  it("derives a stable name from the first 12 chars of the ccauth SHA", () => {
    const sha = "abcdef0123456789deadbeef"
    expect(getCCAuthSnapshotName(sha)).toBe("ccauth-abcdef012345")
  })
})

describe("ensureCCAuthSnapshot", () => {
  it("reuses an already-active snapshot without rebuilding", async () => {
    const { daytona, calls } = makeFakeDaytona({ initial: "active" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    expect(calls).toEqual(["get:active"])
  })

  it("builds the snapshot when it is missing", async () => {
    const { daytona, calls, getState } = makeFakeDaytona({ initial: undefined })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    expect(calls).toEqual(["get:missing", "create"])
    expect(getState()).toBe("active")
  })

  it("deletes and rebuilds a pruned/failed snapshot (the reported bug)", async () => {
    // A snapshot whose backing image was pruned surfaces here as a non-active
    // terminal state; we must delete the dangling record and rebuild.
    const { daytona, calls, getState } = makeFakeDaytona({ initial: "error" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    // delete → wait-for-gone (get:missing) → create
    expect(calls).toEqual(["get:error", "delete", "get:missing", "create"])
    expect(getState()).toBe("active")
  })

  it("force-rebuilds even an active snapshot when rebuild is requested", async () => {
    // This is the recovery path taken after sandbox creation reports a pruned
    // image despite the snapshot metadata looking healthy.
    const { daytona, calls } = makeFakeDaytona({ initial: "active" })
    await ensureCCAuthSnapshot(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      daytona as any,
      "ccauth-x",
      fakeImage,
      { rebuild: true },
    )
    expect(calls).toEqual(["get:active", "delete", "get:missing", "create"])
  })

  it("waits out asynchronous deletion (removing) before recreating", async () => {
    // Regression: Daytona deletion is async — the snapshot sits in `removing`
    // before the name frees up. Recreating too early 409s. Verified end-to-end
    // against real Daytona, where delete() returned `removing`.
    const { daytona, calls, getState } = makeFakeDaytona({
      initial: "error",
      removingReads: 2, // report `removing` once, then the name frees up
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    // It must observe `removing` and wait for `missing` before creating.
    expect(calls).toContain("get:removing")
    expect(calls.indexOf("get:removing")).toBeLessThan(calls.lastIndexOf("create"))
    expect(getState()).toBe("active")
  })

  it("retries the build once when create() 409s on a still-clearing name", async () => {
    // Regression: even after we wait, a race can make the first create() conflict.
    // We should wait and retry rather than surface a hard failure.
    const { daytona, calls, getState } = makeFakeDaytona({
      initial: "error",
      conflictOnCreate: 1, // first create() throws 409, second succeeds
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await ensureCCAuthSnapshot(daytona as any, "ccauth-x", fakeImage)
    expect(calls.filter((c) => c === "create")).toHaveLength(2)
    expect(getState()).toBe("active")
  })
})
