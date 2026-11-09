import { describe, expect, it } from "vitest"
import { ALL_REPOSITORIES, NO_REPOSITORY, DEFAULT_CHAT_VISIBILITY_FILTERS, type ChatVisibilityFilters } from "@/lib/contexts"
import { NEW_REPOSITORY, type Chat } from "@/lib/types"
import {
  buildTreeOrderedChatIds,
  getChatIdForRepoFilter,
  getNextChatIdAfterDeletion,
  isChatVisibleForFilter,
} from "./chat-tree"

// Filter that only shows archived chats — the old ARCHIVED_CHATS sentinel's
// equivalent under the new independent-toggle model.
const ARCHIVED_ONLY: ChatVisibilityFilters = { active: false, scheduled: false, archived: true }
const ACTIVE_ONLY: ChatVisibilityFilters = { active: true, scheduled: false, archived: false }

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
    status: "ready",
    ...overrides,
  }
}

describe("isChatVisibleForFilter", () => {
  it("hides archived chats when only the Active toggle is on", () => {
    const archived = makeChat({ id: "a", archived: true })
    expect(isChatVisibleForFilter(archived, ALL_REPOSITORIES, ACTIVE_ONLY)).toBe(false)
  })

  it("shows only archived chats when only the Archived toggle is on", () => {
    const active = makeChat({ id: "a", archived: false })
    const archived = makeChat({ id: "b", archived: true })
    expect(isChatVisibleForFilter(active, ALL_REPOSITORIES, ARCHIVED_ONLY)).toBe(false)
    expect(isChatVisibleForFilter(archived, ALL_REPOSITORIES, ARCHIVED_ONLY)).toBe(true)
  })

  it("hides archived chats even when their repo matches a specific repo filter (Active toggle only)", () => {
    const archived = makeChat({ id: "a", repo: "octocat/hello", archived: true })
    expect(isChatVisibleForFilter(archived, "octocat/hello", ACTIVE_ONLY)).toBe(false)
  })

  it("hides a scheduled-job chat when the Scheduled toggle is off, shows it when on", () => {
    const scheduled = makeChat({
      id: "a",
      scheduledJobRun: { startedAt: 1, jobName: "Nightly sweep" },
    })
    expect(isChatVisibleForFilter(scheduled, ALL_REPOSITORIES, { active: true, scheduled: false, archived: true })).toBe(false)
    expect(isChatVisibleForFilter(scheduled, ALL_REPOSITORIES, { active: true, scheduled: true, archived: true })).toBe(true)
  })

  it("shows a chat that is both scheduled-job-linked and archived if EITHER toggle is on", () => {
    const both = makeChat({
      id: "a",
      archived: true,
      scheduledJobRun: { startedAt: 1, jobName: "Nightly sweep" },
    })
    expect(isChatVisibleForFilter(both, ALL_REPOSITORIES, { active: false, scheduled: true, archived: false })).toBe(true)
    expect(isChatVisibleForFilter(both, ALL_REPOSITORIES, { active: false, scheduled: false, archived: true })).toBe(true)
    expect(isChatVisibleForFilter(both, ALL_REPOSITORIES, { active: false, scheduled: false, archived: false })).toBe(false)
  })

  it("matches the No-repository filter to NEW_REPOSITORY chats only", () => {
    const noRepo = makeChat({ id: "a", repo: NEW_REPOSITORY })
    const withRepo = makeChat({ id: "b", repo: "octocat/hello" })
    expect(isChatVisibleForFilter(noRepo, NO_REPOSITORY)).toBe(true)
    expect(isChatVisibleForFilter(withRepo, NO_REPOSITORY)).toBe(false)
  })

  it("hides empty chats that are abandoned drafts (no parent, no sandbox)", () => {
    const emptyRoot = makeChat({ id: "a", messages: [], messageCount: 0, sandboxId: null })
    expect(isChatVisibleForFilter(emptyRoot, ALL_REPOSITORIES)).toBe(false)
  })

  it("shows empty chats that were branched (have a parent)", () => {
    const emptyBranch = makeChat({
      id: "b",
      messages: [],
      messageCount: 0,
      sandboxId: null,
      parentChatId: "a",
    })
    expect(isChatVisibleForFilter(emptyBranch, ALL_REPOSITORIES)).toBe(true)
  })

  it("shows empty chats that have been materialized with a sandbox", () => {
    const materializedEmpty = makeChat({ id: "c", messages: [], messageCount: 0, sandboxId: "sb-1" })
    expect(isChatVisibleForFilter(materializedEmpty, ALL_REPOSITORIES)).toBe(true)
  })
})

describe("buildTreeOrderedChatIds", () => {
  // The bug this guards against: archived chats were reachable via Alt+Up/Down
  // even while the sidebar only showed active chats.
  it("never yields an archived chat when only the Active toggle is on", () => {
    const chats = [
      makeChat({ id: "active-1", lastActiveAt: 3 }),
      makeChat({ id: "archived-1", archived: true, lastActiveAt: 2 }),
      makeChat({ id: "active-2", lastActiveAt: 1 }),
    ]
    expect(buildTreeOrderedChatIds(chats, ALL_REPOSITORIES, ACTIVE_ONLY)).toEqual(["active-1", "active-2"])
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
    const repoFilters = [ALL_REPOSITORIES, NO_REPOSITORY, "octocat/hello", "acme/widgets"]
    const visibilityFilters = [DEFAULT_CHAT_VISIBILITY_FILTERS, ARCHIVED_ONLY]
    for (const repoFilter of repoFilters) {
      for (const vf of visibilityFilters) {
        const navigable = new Set(buildTreeOrderedChatIds(chats, repoFilter, vf))
        const visible = new Set(chats.filter((c) => isChatVisibleForFilter(c, repoFilter, vf)).map((c) => c.id))
        expect(navigable).toEqual(visible)
      }
    }
  })
})

// When the open chat is archived it leaves the active view, so selection must
// move to a still-visible neighbor. This is the pure core of setChatArchived:
// resolve the neighbor from the pre-archive tree order (the chat is still
// visible at that instant), then the archive hides it.
describe("selection after archiving the open chat", () => {
  const active = [
    makeChat({ id: "a", lastActiveAt: 3 }),
    makeChat({ id: "b", lastActiveAt: 2 }),
    makeChat({ id: "c", lastActiveAt: 1 }),
  ]
  const order = () => buildTreeOrderedChatIds(active, ALL_REPOSITORIES) // ["a","b","c"]

  it("selects the following chat when a middle chat is archived", () => {
    expect(getNextChatIdAfterDeletion(order(), ["b"])).toBe("c")
  })

  it("selects the previous chat when the last chat is archived", () => {
    expect(getNextChatIdAfterDeletion(order(), ["c"])).toBe("b")
  })

  it("always resolves to a still-visible chat", () => {
    const next = getNextChatIdAfterDeletion(order(), ["a"])
    expect(next).not.toBeNull()
    const nextChat = active.find((c) => c.id === next)!
    expect(isChatVisibleForFilter(nextChat, ALL_REPOSITORIES)).toBe(true)
  })

  it("resolves to null (empty state) when the only visible chat is archived", () => {
    const solo = [makeChat({ id: "only" })]
    const soloOrder = buildTreeOrderedChatIds(solo, ALL_REPOSITORIES)
    expect(getNextChatIdAfterDeletion(soloOrder, ["only"])).toBeNull()
  })
})

describe("getChatIdForRepoFilter", () => {
  it("keeps the current chat when it is still visible under the new filter", () => {
    const chats = [
      makeChat({ id: "a", repo: "octocat/hello", lastActiveAt: 2 }),
      makeChat({ id: "b", repo: "octocat/hello", lastActiveAt: 1 }),
    ]
    // Selecting the same repo the current chat belongs to keeps it selected.
    expect(getChatIdForRepoFilter(chats, "octocat/hello", "b")).toBe("b")
  })

  it("selects the first visible chat when the current chat is filtered out", () => {
    const chats = [
      makeChat({ id: "a", repo: "octocat/hello", lastActiveAt: 2 }),
      makeChat({ id: "b", repo: "octocat/other", lastActiveAt: 1 }),
    ]
    // Current chat "a" belongs to a different repo than the selected filter, so
    // we land on the first (most recent) chat in the filtered list.
    expect(getChatIdForRepoFilter(chats, "octocat/other", "a")).toBe("b")
  })

  it("selects the first visible chat when nothing is currently selected", () => {
    const chats = [
      makeChat({ id: "a", repo: "octocat/hello", lastActiveAt: 1 }),
      makeChat({ id: "b", repo: "octocat/hello", lastActiveAt: 2 }),
    ]
    expect(getChatIdForRepoFilter(chats, "octocat/hello", null)).toBe("b")
  })

  it("returns null when the filter matches no chats", () => {
    const chats = [makeChat({ id: "a", repo: "octocat/hello" })]
    expect(getChatIdForRepoFilter(chats, "octocat/nonexistent", "a")).toBeNull()
  })
})
