import { describe, it, expect } from "vitest"
import {
  hashScript,
  decideSetupScriptSync,
  buildSetupFailureNote,
  isSetupRunRecord,
  MAX_SETUP_SCRIPT_BYTES,
} from "./setup-script"

const SCRIPT = "npm install\n"
const HASH = hashScript(SCRIPT)

describe("decideSetupScriptSync", () => {
  it("skips when the chat has no environment", () => {
    expect(
      decideSetupScriptSync({
        environmentId: null,
        writtenHash: HASH,
        sandboxScript: "changed",
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "skip", reason: "no-environment" })
  })

  it("skips when the file could not be read", () => {
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: null,
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "skip", reason: "unreadable" })
  })

  it("skips when the file is over the size cap", () => {
    const huge = "x".repeat(MAX_SETUP_SCRIPT_BYTES + 1)
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: huge,
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "skip", reason: "too-large" })
  })

  it("skips a multi-byte script that is under the character count but over the byte cap", () => {
    // "é" is one UTF-16 code unit but two bytes in UTF-8. A `.length` check
    // would pass this through; only a byte-length check catches it.
    const multiByte = "é".repeat(MAX_SETUP_SCRIPT_BYTES / 2 + 1)
    expect(multiByte.length).toBeLessThan(MAX_SETUP_SCRIPT_BYTES)
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: multiByte,
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "skip", reason: "too-large" })
  })

  it("skips when the agent did not touch the file", () => {
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: SCRIPT,
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "skip", reason: "unchanged" })
  })

  it("saves when only the sandbox copy changed", () => {
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: "npm ci\n",
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "save", script: "npm ci\n" })
  })

  it("reports a conflict when the stored script also moved off the written hash", () => {
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: "npm ci\n",
        storedScript: "pnpm install\n", // the user edited it mid-run
      })
    ).toEqual({ action: "conflict" })
  })

  it("treats a null stored script as a conflict when the sandbox copy changed", () => {
    // The environment's script was cleared while the chat ran. Saving would
    // silently resurrect it.
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: HASH,
        sandboxScript: "npm ci\n",
        storedScript: null,
      })
    ).toEqual({ action: "conflict" })
  })

  it("skips when there is no written hash to compare against", () => {
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: null,
        sandboxScript: "anything",
        storedScript: SCRIPT,
      })
    ).toEqual({ action: "skip", reason: "unchanged" })
  })
})

describe("buildSetupFailureNote", () => {
  it("names the path, the exit code, and includes the log tail", () => {
    const note = buildSetupFailureNote(1, "npm ERR! missing script")
    expect(note).toContain("/home/daytona/.backgrounder/setup.sh")
    expect(note).toContain("exit code 1")
    expect(note).toContain("npm ERR! missing script")
  })

  it("describes a timeout distinctly, since 124 is the coreutils timeout code", () => {
    const note = buildSetupFailureNote(124, "…")
    expect(note).toContain("timed out")
  })
})

describe("empty setup scripts", () => {
  it("an edit to a previously-empty script is still a save, not a skip", () => {
    const emptyHash = hashScript("")
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: emptyHash,
        sandboxScript: "npm install\n",
        storedScript: "",
      })
    ).toEqual({ action: "save", script: "npm install\n" })
  })

  it("treats a null stored script and an empty written one as a conflict", () => {
    // storedScript null means the DB column is null while we wrote "": the two
    // are not the same value, so the hashes differ and we must not guess.
    const emptyHash = hashScript("")
    expect(
      decideSetupScriptSync({
        environmentId: "env_1",
        writtenHash: emptyHash,
        sandboxScript: "npm install\n",
        storedScript: null,
      })
    ).toEqual({ action: "conflict" })
  })
})

describe("isSetupRunRecord", () => {
  it("accepts a handle-less record that is not running", () => {
    expect(
      isSetupRunRecord({
        environmentId: "env_1",
        writtenHash: hashScript(""),
        startedAt: Date.now(),
        state: "exited",
        exitCode: 0,
        finishedAt: Date.now(),
      })
    ).toBe(true)
  })

  it("rejects a handle-less record claiming to be running", () => {
    // No handle means no job to poll or attach to; a "running" state here
    // would be a lie no later reader could catch.
    expect(
      isSetupRunRecord({
        environmentId: "env_1",
        writtenHash: hashScript(""),
        startedAt: Date.now(),
        state: "running",
      })
    ).toBe(false)
  })
})
