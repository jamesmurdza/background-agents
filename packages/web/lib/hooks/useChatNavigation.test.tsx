import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { SidebarProvider, ModalProvider } from "@/lib/contexts"
import { NEW_REPOSITORY, type Chat } from "@/lib/types"
import { useChatNavigation } from "@/lib/hooks/useChatNavigation"

// The hook reads the session via next-auth's useSession; default to signed-out.
// Individual tests can override with vi.mocked(...).mockReturnValue(...).
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: null, status: "unauthenticated" })),
}))

function wrapper({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <ModalProvider isMobile={false}>{children}</ModalProvider>
    </SidebarProvider>
  )
}

/** Minimal Chat fixture — only the fields the navigation logic reads. */
function mkChat(overrides: Partial<Chat>): Chat {
  return {
    id: "c",
    messages: [{ id: "m" }],
    repo: NEW_REPOSITORY,
    createdAt: 0,
    ...overrides,
  } as Chat
}

type NavProps = Parameters<typeof useChatNavigation>[0]

function makeProps(overrides: Partial<NavProps> = {}): NavProps {
  return {
    isHydrated: true,
    isLoading: false,
    chats: [],
    currentChatId: null,
    displayCurrentChat: null,
    repos: [],
    isDraftChatId: (id: string) => id.startsWith("draft-"),
    selectChat: vi.fn(),
    startNewChat: vi.fn(async () => "new-id"),
    gitDialogs: {
      setMergeOpen: vi.fn(),
      setRebaseOpen: vi.fn(),
      setSelectedBranch: vi.fn(),
    },
    ...overrides,
  }
}

const replaceSpy = vi.spyOn(window.history, "replaceState")
const pushSpy = vi.spyOn(window.history, "pushState")

beforeEach(() => {
  // Reset the URL before clearing, so the reset itself isn't counted as a call.
  window.history.replaceState(null, "", "/")
  replaceSpy.mockClear()
  pushSpy.mockClear()
})

describe("useChatNavigation — stale-chat redirect effect", () => {
  it("redirects to home when the current chat id is unknown", () => {
    const selectChat = vi.fn()
    renderHook(() => useChatNavigation(makeProps({ currentChatId: "ghost", selectChat })), {
      wrapper,
    })

    expect(selectChat).toHaveBeenCalledWith(null)
    expect(replaceSpy).toHaveBeenCalledWith(null, "", "/")
  })

  it("does NOT redirect when the current chat exists", () => {
    const selectChat = vi.fn()
    renderHook(
      () =>
        useChatNavigation(
          makeProps({ currentChatId: "c1", chats: [mkChat({ id: "c1" })], selectChat })
        ),
      { wrapper }
    )

    expect(selectChat).not.toHaveBeenCalled()
    expect(replaceSpy).not.toHaveBeenCalledWith(null, "", "/")
  })

  it("does NOT redirect before the chat list has loaded", () => {
    const selectChat = vi.fn()
    renderHook(
      () => useChatNavigation(makeProps({ currentChatId: "ghost", isLoading: true, selectChat })),
      { wrapper }
    )

    expect(selectChat).not.toHaveBeenCalled()
  })

  it("ignores draft ids (drafts are not real chats yet)", () => {
    const selectChat = vi.fn()
    renderHook(
      () => useChatNavigation(makeProps({ currentChatId: "draft-1", selectChat })),
      { wrapper }
    )

    expect(selectChat).not.toHaveBeenCalled()
  })
})

describe("useChatNavigation — draft-promotion effect", () => {
  it("promotes the URL to /chat/{id} once a draft materializes into a real chat", () => {
    const props = makeProps({
      currentChatId: "draft-1",
      // Include the real chat so the stale-redirect effect doesn't fire post-promotion.
      chats: [mkChat({ id: "real-1" })],
    })
    const { rerender } = renderHook((p: NavProps) => useChatNavigation(p), {
      wrapper,
      initialProps: props,
    })

    expect(replaceSpy).not.toHaveBeenCalledWith(null, "", "/chat/real-1")

    rerender({ ...props, currentChatId: "real-1" })

    expect(replaceSpy).toHaveBeenCalledWith(null, "", "/chat/real-1")
  })
})

describe("useChatNavigation — handlers", () => {
  it("handleSelectChat selects the chat and pushes its URL", () => {
    const selectChat = vi.fn()
    const { result } = renderHook(() => useChatNavigation(makeProps({ selectChat })), { wrapper })

    act(() => result.current.handleSelectChat("c1"))

    expect(selectChat).toHaveBeenCalledWith("c1")
    expect(pushSpy).toHaveBeenCalledWith(null, "", "/chat/c1")
  })

  it("getNextChatId returns the chat following the deleted one in tree order", () => {
    const chats = [
      mkChat({ id: "c1", lastActiveAt: 3 }),
      mkChat({ id: "c2", lastActiveAt: 2 }),
      mkChat({ id: "c3", lastActiveAt: 1 }),
    ]
    const { result } = renderHook(
      () => useChatNavigation(makeProps({ chats, repos: [] })),
      { wrapper }
    )

    // Tree order is [c1, c2, c3]; deleting c2 should select the following chat, c3.
    expect(result.current.getNextChatId(["c2"])).toBe("c3")
    // Deleting the last chat falls back to the previous one.
    expect(result.current.getNextChatId(["c3"])).toBe("c2")
  })
})
