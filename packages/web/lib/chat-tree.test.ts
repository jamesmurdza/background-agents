import { describe, expect, it } from "vitest"
import { ALL_REPOSITORIES, NO_REPOSITORY, ARCHIVED_CHATS } from "@/lib/contexts"
import { NEW_REPOSITORY, type Chat } from "@/lib/types"
import { buildTreeOrderedChatIds, isChatVisibleForFilter } from "./chat-tree"

/** Build a minimally-valid Chat with sane defaults, overridable per field. */
function makeChat(overrides: Partial<Chat> & Pick<Chat, "id">): Chat {
  return {
    repo: "octocat/hello",
    baseBranch: "main",
    branch: null,
    sandboxId: null,
    sessionId: null,
    messages: [],
    messageCount: 1, // treated as "has messages" unless overridden
    createdAt: 0,
    updatedAt: 0,
    displayName: overrides.id,
    status: "idle" as Chat["status"],
    ...overrides,
  }
}

describe("isChatVisibleForFilter", () => {
  it("hides archived chats under the Active-chats (all repos) filter", () => {
    const archived = makeChat({ id: "a", archived: true })
    expect(isChatVisibleForFilter(archived, ALL_REPOSITORIES)).toBe(false)
  })

  it("shows only archived chats under the Archived filter", () => {
    const active = makeChat({ id: "a", archived: false })
    const archived = makeChat({ id: "b", archived: true })
    expect(isChatVisibleForFilter(active, ARCHIVED_CHATS)).toBe(false)
    expect(isChatVisibleForFilter(archived, ARCHIVED_CHATS)).toBe(true)
  })

  it("hides archived chats even when their repo matches a specific repo filter", () => {
    const archived = makeChat({ id: "a", repo: "octocat/hello", archived: true })
    expect(isChatVisibleForFilter(archived, "octocat/hello")).toBe(false)
  })

  it("matches the No-repository filter to NEW_REPOSITORY chats only", () => {
    const noRepo = makeChat({ id: "a", repo: NEW_REPOSITORY })
    const withRepo = makeChat({ id: "b", repo: "octocat/hello" })
    expect(isChatVisibleForFilter(noRepo, NO_REPOSITORY)).toBe(true)
    expect(isChatVisibleForFilter(withRepo, NO_REPOSITORY)).toBe(false)
  })

  it("hides empty chats unless they were branched (have a parent)", () => {
    const emptyRoot = makeChat({ id: "a", messages: [], messageCount: 0 })
    const emptyBranch = makeChat({ id: "b", messages: [], messageCount: 0, parentChatId: "a" })
    expect(isChatVisibleForFilter(emptyRoot, ALL_REPOSITORIES)).toBe(false)
    expect(isChatVisibleForFilter(emptyBranch, ALL_REPOSITORIES)).toBe(true)
  })
})

describe("buildTreeOrderedChatIds", () => {
  // The bug this guards against: archived chats were reachable via Alt+Up/Down
  // even while the sidebar only showed active chats.
  it("never yields an archived chat under the Active-chats filter", () => {
    const chats = [
      makeChat({ id: "active-1", lastActiveAt: 3 }),
      makeChat({ id: "archived-1", archived: true, lastActiveAt: 2 }),
      makeChat({ id: "active-2", lastActiveAt: 1 }),
    ]
    expect(buildTreeOrderedChatIds(chats, ALL_REPOSITORIES)).toEqual(["active-1", "active-2"])
  })

  // The invariant that makes the whole bug-class impossible: what you can
  // navigate to is EXACTLY what the sidebar shows. Both derive from
  // isChatVisibleForFilter, so this asserts they can never drift.
  it("navigable ids equal the isChatVisibleForFilter set for every filter", () => {
    const chats = [
      makeChat({ id: "own-active", repo: "octocat/hello", lastActiveAt: 5 }),
      makeChat({ id: "own-archived", repo: "octocat/hello", archived: true, lastActiveAt: 4 }),
      makeChat({ id: "other-repo", repo: "acme/widgets", lastActiveAt: 3 }),
      makeChat({ id: "no-repo", repo: NEW_REPOSITORY, lastActiveAt: 2 }),
      makeChat({ id: "empty-root", messages: [], messageCount: 0, lastActiveAt: 1 }),
    ]
    const filters = [ALL_REPOSITORIES, ARCHIVED_CHATS, NO_REPOSITORY, "octocat/hello", "acme/widgets"]
    for (const filter of filters) {
      const navigable = new Set(buildTreeOrderedChatIds(chats, filter))
      const visible = new Set(chats.filter((c) => isChatVisibleForFilter(c, filter)).map((c) => c.id))
      expect(navigable).toEqual(visible)
    }
  })
})
