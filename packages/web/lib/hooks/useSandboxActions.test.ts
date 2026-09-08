import { afterEach, describe, expect, it, vi } from "vitest"
import { patchJsonOrThrow } from "./useSandboxActions"

describe("patchJsonOrThrow", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("resolves without throwing on a 2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })))

    await expect(patchJsonOrThrow("/api/user/repo-env", { repo: "acme/app" })).resolves.toBeUndefined()
  })

  it("throws with the server's error message on a non-2xx response", async () => {
    // Before this fix, handleSaveEnvVars awaited a PATCH like this without
    // checking response.ok, so a 400 (e.g. an invalid environment variable
    // name) was silently swallowed and the caller reported success anyway.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: 'Invalid environment variable name: "9FOO".' }, { status: 400 })
      )
    )

    await expect(patchJsonOrThrow("/api/user/repo-env", { repo: "acme/app" })).rejects.toThrow(
      'Invalid environment variable name: "9FOO".'
    )
  })

  it("falls back to a generic message when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not json", { status: 500 }))
    )

    await expect(patchJsonOrThrow("/api/user/repo-env", {})).rejects.toThrow("Request failed (500)")
  })
})
