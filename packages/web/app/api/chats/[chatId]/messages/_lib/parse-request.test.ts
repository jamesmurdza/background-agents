import { describe, expect, it } from "vitest"
import type { NextRequest } from "next/server"
import { parseMessageRequest } from "./parse-request"

const fields = { agent: "eliza", model: "eliza-classic-1.0", userMessageId: "u1", assistantMessageId: "a1" }

function multipart(message: string, files: File[]) {
  const form = new FormData()
  form.append("payload", JSON.stringify({ ...fields, message }))
  files.forEach((file, i) => form.append(`file-${i}`, file))
  return new Request("http://test/api/chats/c1/messages", { method: "POST", body: form }) as unknown as NextRequest
}

describe("parseMessageRequest", () => {
  it("accepts an attachment without text", async () => {
    const parsed = await parseMessageRequest(multipart("", [new File(["png"], "shot.png", { type: "image/png" })]))
    expect(parsed).not.toBeInstanceOf(Response)
    expect(parsed).toMatchObject({ payload: { message: "" }, files: [{ name: "shot.png" }] })
  })

  it("rejects a message with neither text nor attachments", async () => {
    const json = new Request("http://test/api/chats/c1/messages", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...fields, message: "" }),
    }) as unknown as NextRequest
    for (const req of [multipart("", []), json]) {
      const res = await parseMessageRequest(req)
      expect(res).toBeInstanceOf(Response)
      expect((res as Response).status).toBe(400)
    }
  })
})
