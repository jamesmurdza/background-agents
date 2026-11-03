import { describe, it, expect } from "vitest"
import { commentBoxPosition, formatElementComment, type SelectedElement } from "./element-picker"

const element: SelectedElement = {
  path: "/checkout",
  html: '<button class="btn">Pay now</button>',
  selector: "main > button.btn",
  rect: { top: 100, left: 40, bottom: 130 },
}

describe("formatElementComment", () => {
  it("puts the element before the comment", () => {
    expect(formatElementComment(element, "  Make it darker.\n")).toBe(
      'On /checkout, <button class="btn">Pay now</button> (main > button.btn):\nMake it darker.'
    )
  })
})

describe("commentBoxPosition", () => {
  const panel = { width: 800, height: 600 }

  it("goes under the element", () => {
    expect(commentBoxPosition(element.rect, 1, panel)).toEqual({ top: 138, left: 40 })
  })

  it("follows the preview's zoom", () => {
    expect(commentBoxPosition(element.rect, 0.5, panel)).toEqual({ top: 73, left: 20 })
  })

  it("goes above the element when there's no room below", () => {
    expect(commentBoxPosition({ top: 500, left: 40, bottom: 560 }, 1, panel)).toEqual({ top: 352, left: 40 })
  })

  it("stays inside the panel", () => {
    expect(commentBoxPosition({ top: 0, left: 700, bottom: 20 }, 1, panel)).toEqual({ top: 28, left: 504 })
  })
})
