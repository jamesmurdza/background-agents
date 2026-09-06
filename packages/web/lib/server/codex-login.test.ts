import { describe, it, expect, vi } from "vitest"

// These tests exercise only the pure parsing helpers, but importing the module
// pulls in @/lib/db/prisma transitively (via storeCodexCredential and this
// module's own CcAuthInfo persistence), which throws at import time when
// DATABASE_URL isn't set. Stub it out, same pattern as
// lib/server/codex-credentials.test.ts.
vi.mock("@/lib/db/prisma", () => ({
  prisma: { ccAuthInfo: {}, user: {}, $transaction: vi.fn() },
}))

import { parseDeviceCodePrompt, classifyDeviceAuthFailure } from "./codex-login"

// Real output from `codex login --device-auth`, ANSI colour codes included.
const REAL_OUTPUT = `Welcome to Codex [v[90m0.153.4[0m]
[90mOpenAI's command-line coding agent[0m

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   [94mhttps://auth.openai.com/codex/device[0m

2. Enter this one-time code [90m(expires in 15 minutes)[0m
   [94mX2BM-0QC5V[0m
`

describe("parseDeviceCodePrompt", () => {
  it("extracts the URL and code from real CLI output with ANSI codes", () => {
    expect(parseDeviceCodePrompt(REAL_OUTPUT)).toEqual({
      url: "https://auth.openai.com/codex/device",
      code: "X2BM-0QC5V",
    })
  })

  it("returns null before the CLI has printed the prompt", () => {
    expect(parseDeviceCodePrompt("Welcome to Codex\n")).toBeNull()
  })
})

describe("classifyDeviceAuthFailure", () => {
  it("recognises the account-level toggle being off", () => {
    expect(classifyDeviceAuthFailure("error: device code login is not enabled for this account")).toBe(
      "device_auth_disabled"
    )
  })

  it("recognises a workspace admin policy block", () => {
    expect(
      classifyDeviceAuthFailure("Device code authorization is disabled by your workspace admin")
    ).toBe("admin_blocked")
  })

  it("falls back to unknown", () => {
    expect(classifyDeviceAuthFailure("connection reset by peer")).toBe("unknown")
  })
})
