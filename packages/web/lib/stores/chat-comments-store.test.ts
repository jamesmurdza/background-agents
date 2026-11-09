import { describe, it, expect } from "vitest"
import { withPendingComments, type PendingComment } from "./chat-comments-store"

const comment = (context: string, text: string): PendingComment => ({
  id: "1",
  label: "main.jsx:1",
  context,
  comment: text,
})

describe("withPendingComments", () => {
  it("quotes every line of the context, then the comment", () => {
    expect(withPendingComments("", [comment("On a.ts:1:\n```diff\n+x\n```", "Rename it")])).toBe(
      "> On a.ts:1:\n> ```diff\n> +x\n> ```\n\nRename it"
    )
  })

  it("puts several comments before what was typed", () => {
    expect(withPendingComments("  Then run the tests. ", [comment("A", "one"), comment("B", "two")])).toBe(
      "> A\n\none\n\n> B\n\ntwo\n\nThen run the tests."
    )
  })

  it("leaves a message without comments as typed", () => {
    expect(withPendingComments(" hello ", [])).toBe("hello")
    expect(withPendingComments("  ", [])).toBe("")
  })
})
