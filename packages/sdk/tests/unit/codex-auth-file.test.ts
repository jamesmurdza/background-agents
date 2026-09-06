import { describe, it, expect } from "vitest"
import { buildCodexAuthSetupCommand } from "../../src/agents/codex"

describe("buildCodexAuthSetupCommand", () => {
  const blob = JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: { id_token: "id", access_token: "at", refresh_token: "rt.PLACEHOLDER", account_id: "a1" },
    last_refresh: "2026-09-05T00:00:00.000Z",
  })

  it("creates ~/.codex and writes auth.json with 600 permissions", () => {
    const cmd = buildCodexAuthSetupCommand(blob)
    expect(cmd).toContain("mkdir -p")
    expect(cmd).toContain(".codex")
    expect(cmd).toContain("auth.json")
    expect(cmd).toContain("chmod 600")
  })

  it("escapes single quotes so a crafted token cannot break out of the quoted string", () => {
    // escapeShell (packages/sdk/src/utils/shell.ts) turns ' into '\'' — the only
    // character that can terminate a single-quoted shell string. Everything else,
    // $(…) included, is inert inside single quotes.
    const nasty = JSON.stringify({ tokens: { access_token: "a'; rm -rf /; echo '" } })
    const cmd = buildCodexAuthSetupCommand(nasty)
    expect(cmd).toContain("'\\''")
    // Verify that removing escape sequences leaves no unescaped quotes that could
    // break out of the shell string. The payload is between printf '%s' ' and ' > '.
    const start = cmd.indexOf("printf '%s' '") + "printf '%s' '".length
    const payload = cmd.slice(start, cmd.indexOf("' > '"))
    expect(payload.replace(/'\\''/g, "")).not.toContain("'")
  })
})
