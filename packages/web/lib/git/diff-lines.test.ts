import { describe, it, expect } from "vitest"
import { describeLines, lineCommentContext, numberDiffLines } from "./diff-lines"

const patch = [
  "@@ -10,3 +10,3 @@ export function Checkout() {",
  "   <div>",
  "-    <Button>Buy</Button>",
  "+    <Button>Pay now</Button>",
  "   </div>",
  "@@ -40,2 +40,3 @@",
  "   return total",
  "+  // TODO",
  " }",
  "\\ No newline at end of file",
]

describe("numberDiffLines", () => {
  it("counts old and new lines from each hunk header", () => {
    expect(numberDiffLines(patch).map(({ oldLine, newLine }) => [oldLine, newLine])).toEqual([
      [undefined, undefined],
      [10, 10],
      [11, undefined],
      [undefined, 11],
      [12, 12],
      [undefined, undefined],
      [40, 40],
      [undefined, 41],
      [41, 42],
      [undefined, undefined],
    ])
  })
})

describe("lineCommentContext", () => {
  const lines = numberDiffLines(patch)

  it("gives the location, then the lines", () => {
    expect(lineCommentContext("src/checkout.tsx", lines.slice(3, 4))).toBe(
      "On src/checkout.tsx:11:\n```diff\n+    <Button>Pay now</Button>\n```"
    )
  })

  it("names a range by its new-file lines", () => {
    expect(describeLines("src/checkout.tsx", lines.slice(1, 5))).toBe("src/checkout.tsx:10-12")
  })

  it("uses old-file lines when everything was removed", () => {
    expect(describeLines("src/checkout.tsx", lines.slice(2, 3))).toBe("src/checkout.tsx:11 (removed)")
  })
})
