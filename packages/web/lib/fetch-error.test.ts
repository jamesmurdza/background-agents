import { describe, expect, it } from "vitest"
import { extractErrorMessage } from "./fetch-error"

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body))
}

function nonJsonResponse(): Response {
  return new Response("<html>502 Bad Gateway</html>")
}

describe("extractErrorMessage", () => {
  it("prefers the error field", async () => {
    await expect(
      extractErrorMessage(jsonResponse({ error: "bad request", message: "ignored" }), "fallback")
    ).resolves.toBe("bad request")
  })

  it("falls back to the message field when error is absent", async () => {
    await expect(
      extractErrorMessage(jsonResponse({ message: "not found" }), "fallback")
    ).resolves.toBe("not found")
  })

  it("falls back to the default when the body has neither field", async () => {
    await expect(extractErrorMessage(jsonResponse({}), "fallback")).resolves.toBe("fallback")
  })

  it("falls back to the default when the body isn't JSON", async () => {
    await expect(extractErrorMessage(nonJsonResponse(), "fallback")).resolves.toBe("fallback")
  })

  it("ignores non-string error/message values", async () => {
    await expect(
      extractErrorMessage(jsonResponse({ error: 123, message: null }), "fallback")
    ).resolves.toBe("fallback")
  })
})
