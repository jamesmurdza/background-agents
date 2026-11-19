/**
 * An authenticated command carries the token in its auth header, and callers
 * log the errors these commands throw. Uses a fake sandbox process, so it does
 * not require a sandbox or Daytona credentials.
 */
import { inspect } from "node:util"
import { describe, expect, it } from "vitest"
import { redactToken } from "../src/auth.js"
import { clone, fetch, fetchBranch, pull, push } from "../src/commands.js"
import { GitAuthError, GitError, GitNotFoundError } from "../src/errors.js"
import type { SandboxProcess } from "../src/types.js"

const TOKEN = "gho_exampleToken1234567890abcdef"
const ENCODED = Buffer.from(`x-access-token:${TOKEN}`).toString("base64")

const failing = (result: string): SandboxProcess => ({
  executeCommand: async () => ({ exitCode: 128, result }),
})

const operations = {
  clone: (p: SandboxProcess) => clone(p, "https://github.com/owner/repo.git", "/repo", "main", undefined, TOKEN),
  fetch: (p: SandboxProcess) => fetch(p, "/repo", TOKEN),
  fetchBranch: (p: SandboxProcess) => fetchBranch(p, "/repo", "main", TOKEN),
  pull: (p: SandboxProcess) => pull(p, "/repo", TOKEN),
  push: (p: SandboxProcess) => push(p, "/repo", TOKEN),
}

const failures = [
  { kind: GitAuthError, output: "fatal: could not read Username for 'https://github.com': No such device or address" },
  { kind: GitNotFoundError, output: "remote: Repository not found." },
  { kind: GitError, output: "fatal: unable to access 'https://github.com/owner/repo.git/': Could not resolve host" },
]

describe("errors from authenticated commands", () => {
  for (const [name, run] of Object.entries(operations)) {
    for (const { kind, output } of failures) {
      it(`${name} throws a ${kind.name} without the token`, async () => {
        const error = await run(failing(output)).then(() => undefined, (e: unknown) => e)

        expect(error).toBeInstanceOf(kind)
        const gitError = error as GitError
        for (const text of [gitError.message, gitError.command, gitError.output, inspect(gitError)]) {
          expect(text).not.toContain(TOKEN)
          expect(text).not.toContain(ENCODED)
        }
        expect(gitError.command).toContain("Authorization: Basic ***")
      })
    }
  }

  it("hides the token wherever git prints it, not only in the auth header", async () => {
    const output = `fatal: unable to access 'https://x-access-token:${TOKEN}@github.com/owner/repo.git/': The requested URL returned error: 500`
    const error = (await fetch(failing(output), "/repo", TOKEN).catch((e: unknown) => e)) as GitError

    expect(error.output).toBe("fatal: unable to access 'https://x-access-token:***@github.com/owner/repo.git/': The requested URL returned error: 500")
    expect(error.message).not.toContain(TOKEN)
  })

  it("hides the auth header when git echoes it in its output", async () => {
    const output = `> GET /owner/repo.git/info/refs HTTP/2\n> authorization: Basic ${ENCODED}\n< HTTP/2 500`
    const error = (await fetch(failing(output), "/repo", TOKEN).catch((e: unknown) => e)) as GitError

    expect(error.output).toBe("> GET /owner/repo.git/info/refs HTTP/2\n> authorization: Basic ***\n< HTTP/2 500")
    expect(error.message).not.toContain(ENCODED)
  })

  it("leaves text alone without a token", () => {
    expect(redactToken("fatal: no token here", "")).toBe("fatal: no token here")
    expect(redactToken("fatal: no token here", undefined)).toBe("fatal: no token here")
  })
})
