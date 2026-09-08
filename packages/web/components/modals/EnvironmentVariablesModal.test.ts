import { describe, it, expect, vi } from "vitest"
import { runSaveEnvVars } from "./EnvironmentVariablesModal"

describe("runSaveEnvVars", () => {
  it("clears any previous error and closes the modal on a successful save", async () => {
    const setError = vi.fn()
    const onClose = vi.fn()
    const onSave = vi.fn().mockResolvedValue(undefined)

    await runSaveEnvVars({
      onSave,
      chatEnvVars: { FOO: "1" },
      repoEnvVars: {},
      setError,
      onClose,
    })

    expect(onSave).toHaveBeenCalledWith({ FOO: "1" }, {})
    expect(setError).toHaveBeenCalledWith(null)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("keeps the modal open and surfaces the error message on a rejected save", async () => {
    // This is the bug the coordinator flagged: before this fix, a rejected
    // save was swallowed and the modal closed anyway, reporting success that
    // never happened.
    const setError = vi.fn()
    const onClose = vi.fn()
    const onSave = vi
      .fn()
      .mockRejectedValue(new Error('Invalid environment variable name: "9FOO".'))

    await runSaveEnvVars({
      onSave,
      chatEnvVars: { "9FOO": "1" },
      repoEnvVars: {},
      setError,
      onClose,
    })

    expect(setError).toHaveBeenLastCalledWith('Invalid environment variable name: "9FOO".')
    expect(onClose).not.toHaveBeenCalled()
  })

  it("falls back to a generic message when the rejection isn't an Error", async () => {
    const setError = vi.fn()
    const onClose = vi.fn()
    const onSave = vi.fn().mockRejectedValue("nope")

    await runSaveEnvVars({ onSave, chatEnvVars: {}, repoEnvVars: {}, setError, onClose })

    expect(setError).toHaveBeenLastCalledWith("Failed to save")
    expect(onClose).not.toHaveBeenCalled()
  })
})
