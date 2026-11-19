import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { Chat } from "@/lib/types"

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "test" }, expires: "2099" } }) }))
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }))
import { useBranching } from "./useBranching"

describe("branch-and-send", () => {
  it("sends the message's attachments to the new branch chat", async () => {
    const chat = { id: "chat-1", repo: "owner/repo", baseBranch: "main", branch: null, agent: "eliza", model: "eliza-classic-1.0", messages: [] } as unknown as Chat
    const startNewChat = vi.fn(async () => "branch-chat")
    const sendMessage = vi.fn()
    let branching: ReturnType<typeof useBranching> | undefined
    function Probe() {
      branching = useBranching({ currentChat: chat, chats: [chat], startNewChat, sendMessage, removeQueuedMessage: vi.fn(), openSignInModal: vi.fn() })
      return null
    }
    renderToStaticMarkup(createElement(Probe))

    const file = new File(["png"], "shot.png", { type: "image/png" })
    await branching!.handleBranchWithMessage("", "eliza", "eliza-classic-1.0", undefined, [file])
    // Created in the background (no switch), then sent the file.
    expect(startNewChat).toHaveBeenCalledWith("owner/repo", "main", "chat-1", false, "pending", "eliza", "eliza-classic-1.0")
    expect(sendMessage).toHaveBeenCalledWith("", "eliza", "eliza-classic-1.0", [file], "branch-chat", undefined, undefined)
  })
})
