/**
 * Tests for createSandboxForChat's cleanup-on-failure behavior.
 *
 * The sandbox is created first, then a sequence of awaits (repo setup, setup
 * script) run against it. Any of those can throw. Before this fix, a throw in
 * that span left the sandbox behind with its id recorded nowhere: the caller
 * never gets a value back to clean up with. This suite checks that a failure
 * anywhere after `daytona.create` deletes the sandbox it just created and
 * rethrows the original error unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

vi.mock("@background-agents/sandbox-git", () => ({
  createSandboxGit: vi.fn(),
}))

vi.mock("@background-agents/common", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, getRepoBranches: vi.fn() }
})

vi.mock("@background-agents/sandbox-skills/sandbox", () => ({
  installSkills: vi.fn(),
  discoverInstalledSkills: vi.fn(),
}))

const getActiveSnapshotName = vi.fn().mockResolvedValue("snapshot-1")
vi.mock("@background-agents/sandbox-image", () => ({
  TOKSCALE_VERSION: "0.0.0",
  getActiveSnapshotName: (...args: unknown[]) => getActiveSnapshotName(...args),
}))

vi.mock("@/lib/sandbox-create-params", () => ({
  buildSandboxCreateParams: vi.fn().mockReturnValue({}),
}))

const writeSetupScript = vi.fn()
const startSetupJob = vi.fn()
vi.mock("@/lib/setup-script", () => ({
  writeSetupScript: (...args: unknown[]) => writeSetupScript(...args),
  startSetupJob: (...args: unknown[]) => startSetupJob(...args),
}))

import { createSandboxForChat } from "./sandbox"
import { NEW_REPOSITORY } from "@/lib/types"

function makeSandbox() {
  return {
    id: "sbx-1",
    process: {
      executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, result: "" }),
    },
    getPreviewLink: vi.fn().mockResolvedValue({ url: "https://sbx-1-3000.example.com" }),
  }
}

function makeDaytona(sandbox: ReturnType<typeof makeSandbox>) {
  const deleteFn = vi.fn().mockResolvedValue(undefined)
  const daytona = {
    create: vi.fn().mockResolvedValue(sandbox),
    get: vi.fn().mockResolvedValue({ ...sandbox, delete: deleteFn }),
  }
  return { daytona, deleteFn }
}

const resolvedEnvironment = {
  id: "env_1",
  name: "Default",
  repo: NEW_REPOSITORY,
  isDefault: true,
  networkMode: "full" as const,
  allowedDomains: [],
  variables: {},
  setupScript: "npm install\n",
}

beforeEach(() => {
  writeSetupScript.mockReset()
  startSetupJob.mockReset()
  getActiveSnapshotName.mockClear()
})

describe("createSandboxForChat: cleanup on failure", () => {
  it("deletes the just-created sandbox and rethrows when startSetupJob throws", async () => {
    const sandbox = makeSandbox()
    const { daytona, deleteFn } = makeDaytona(sandbox)
    writeSetupScript.mockResolvedValue("hash-1")
    const boom = new Error("boom: sandbox-jobs unavailable")
    startSetupJob.mockRejectedValue(boom)

    await expect(
      createSandboxForChat({
        daytona: daytona as never,
        repo: NEW_REPOSITORY,
        baseBranch: "main",
        newBranch: "agent/abcd1234",
        userId: "user-1",
        environment: resolvedEnvironment,
      })
    ).rejects.toThrow(boom)

    expect(daytona.get).toHaveBeenCalledWith("sbx-1")
    expect(deleteFn).toHaveBeenCalledOnce()
  })

  it("does not touch the sandbox and does not run setup when the earlier repo setup throws", async () => {
    const sandbox = makeSandbox()
    sandbox.process.executeCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, result: "" }) // mkdir LOGS_DIR
      .mockRejectedValueOnce(new Error("mkdir failed"))
    const { daytona, deleteFn } = makeDaytona(sandbox)

    await expect(
      createSandboxForChat({
        daytona: daytona as never,
        repo: NEW_REPOSITORY,
        baseBranch: "main",
        newBranch: "agent/abcd1234",
        userId: "user-1",
        environment: resolvedEnvironment,
      })
    ).rejects.toThrow("mkdir failed")

    expect(deleteFn).toHaveBeenCalledOnce()
    expect(writeSetupScript).not.toHaveBeenCalled()
    expect(startSetupJob).not.toHaveBeenCalled()
  })

  it("succeeds and never deletes the sandbox on the happy path", async () => {
    const sandbox = makeSandbox()
    const { daytona, deleteFn } = makeDaytona(sandbox)
    writeSetupScript.mockResolvedValue("hash-1")
    startSetupJob.mockResolvedValue({
      jobId: "job-1",
      dir: "/tmp/job",
      outputFile: "/tmp/job/out",
      exitFile: "/tmp/job/exit",
      pgid: 1,
      cgroup: "cg-1",
    })

    const result = await createSandboxForChat({
      daytona: daytona as never,
      repo: NEW_REPOSITORY,
      baseBranch: "main",
      newBranch: "agent/abcd1234",
      userId: "user-1",
      environment: resolvedEnvironment,
    })

    expect(result.sandboxId).toBe("sbx-1")
    expect(result.setupRun?.state).toBe("running")
    expect(daytona.get).not.toHaveBeenCalled()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it("passes setupScriptTimeoutSeconds through to startSetupJob, for a shorter validation-run cap", async () => {
    const sandbox = makeSandbox()
    const { daytona } = makeDaytona(sandbox)
    writeSetupScript.mockResolvedValue("hash-1")
    startSetupJob.mockResolvedValue({
      jobId: "job-1",
      dir: "/tmp/job",
      outputFile: "/tmp/job/out",
      exitFile: "/tmp/job/exit",
      pgid: 1,
      cgroup: "cg-1",
    })

    await createSandboxForChat({
      daytona: daytona as never,
      repo: NEW_REPOSITORY,
      baseBranch: "main",
      newBranch: "agent/abcd1234",
      userId: "user-1",
      environment: resolvedEnvironment,
      setupScriptTimeoutSeconds: 180,
    })

    expect(startSetupJob).toHaveBeenCalledWith(sandbox, expect.any(String), {}, 180)
  })

  it("leaves startSetupJob's timeout to its own default when setupScriptTimeoutSeconds is omitted", async () => {
    const sandbox = makeSandbox()
    const { daytona } = makeDaytona(sandbox)
    writeSetupScript.mockResolvedValue("hash-1")
    startSetupJob.mockResolvedValue({
      jobId: "job-1",
      dir: "/tmp/job",
      outputFile: "/tmp/job/out",
      exitFile: "/tmp/job/exit",
      pgid: 1,
      cgroup: "cg-1",
    })

    await createSandboxForChat({
      daytona: daytona as never,
      repo: NEW_REPOSITORY,
      baseBranch: "main",
      newBranch: "agent/abcd1234",
      userId: "user-1",
      environment: resolvedEnvironment,
    })

    expect(startSetupJob).toHaveBeenCalledWith(sandbox, expect.any(String), {}, undefined)
  })

  it("skips writing and starting the setup script when runSetupScript is false", async () => {
    const sandbox = makeSandbox()
    const { daytona } = makeDaytona(sandbox)

    const result = await createSandboxForChat({
      daytona: daytona as never,
      repo: NEW_REPOSITORY,
      baseBranch: "main",
      newBranch: "agent/abcd1234",
      userId: "user-1",
      environment: resolvedEnvironment,
      runSetupScript: false,
    })

    expect(writeSetupScript).not.toHaveBeenCalled()
    expect(startSetupJob).not.toHaveBeenCalled()
    expect(result.setupRun).toBeNull()
  })
})
