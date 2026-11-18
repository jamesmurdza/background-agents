import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { Message } from "@/lib/types"
import { MessageBubble } from "./MessageBubble"

const render = (message: Partial<Message>) => renderToStaticMarkup(createElement(MessageBubble, {
  message: { id: "m1", role: "user", content: "", timestamp: 0, ...message },
}))

describe("user message bubble", () => {
  it("shows only the file list for a message with no text", () => {
    const html = render({ uploadedFiles: ["/home/daytona/uploads/shot.png"] })
    expect(html).toContain("shot.png")
    expect(html).not.toContain("bg-muted")
  })

  it("shows the text and the files together", () => {
    const html = render({ content: "What is this?", uploadedFiles: ["/home/daytona/uploads/shot.png"] })
    expect(html).toContain("What is this?")
    expect(html).toContain("bg-muted")
    expect(html).toContain("shot.png")
  })
})
