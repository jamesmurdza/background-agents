import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

// Mock the prisma singleton: lib/db/prisma.ts constructs a PrismaClient at
// module scope and throws when DATABASE_URL is unset. Most tests in this file
// are pure and never touch this mock; getOrCreateDefaultEnvironment's race
// handling does, so `environment` needs real jest-fn behavior rather than an
// empty object. `vi.hoisted` lets the factory (which is hoisted above
// imports) see the mocks.
const { environment } = vi.hoisted(() => ({
  environment: {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: { environment, $transaction: vi.fn(async (ops: unknown[]) => ops) },
}))

import {
  decryptEnvironmentVariables,
  encryptEnvironmentVariables,
  resolveDomainAllowList,
  getOrCreateDefaultEnvironment,
  type ResolvedEnvironment,
} from "./environments"
import { encrypt } from "./db/encryption"
import { BASELINE_DOMAINS } from "@background-agents/common"

/** A P2002 error the way Prisma actually throws it. */
function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  })
}

beforeEach(() => {
  environment.findFirst.mockReset()
  environment.create.mockReset()
  environment.updateMany.mockReset()
  environment.update.mockReset()
})

function env(overrides: Partial<ResolvedEnvironment> = {}): ResolvedEnvironment {
  return {
    id: "env_1",
    name: "Default",
    repo: "acme/app",
    isDefault: true,
    networkMode: "full",
    allowedDomains: [],
    variables: {},
    setupScript: null,
    ...overrides,
  }
}

describe("decryptEnvironmentVariables", () => {
  it("decrypts every stored value", () => {
    const stored = { API_KEY: encrypt("secret"), OTHER: encrypt("two") }
    expect(decryptEnvironmentVariables(stored)).toEqual({ API_KEY: "secret", OTHER: "two" })
  })

  it("returns an empty object for null, undefined, or a non-object", () => {
    expect(decryptEnvironmentVariables(null)).toEqual({})
    expect(decryptEnvironmentVariables(undefined)).toEqual({})
    expect(decryptEnvironmentVariables("nonsense")).toEqual({})
  })

  it("skips empty values rather than emitting empty strings", () => {
    expect(decryptEnvironmentVariables({ A: encrypt("x"), B: "" })).toEqual({ A: "x" })
  })
})

describe("encryptEnvironmentVariables", () => {
  it("round-trips through decrypt", () => {
    const out = encryptEnvironmentVariables({ TOKEN: "abc" })
    expect(out.TOKEN).not.toBe("abc")
    expect(decryptEnvironmentVariables(out)).toEqual({ TOKEN: "abc" })
  })

  it("trims keys and drops blank ones", () => {
    const out = encryptEnvironmentVariables({ "  A  ": "1", "": "2", "   ": "3" })
    expect(Object.keys(out)).toEqual(["A"])
  })
})

describe("resolveDomainAllowList", () => {
  it("returns undefined in full mode so Daytona applies no restriction", () => {
    expect(resolveDomainAllowList(env({ networkMode: "full" }))).toBeUndefined()
  })

  it("returns undefined in full mode even when domains are listed", () => {
    expect(
      resolveDomainAllowList(env({ networkMode: "full", allowedDomains: ["example.com"] }))
    ).toBeUndefined()
  })

  it("joins the baseline with the user's domains in restricted mode", () => {
    const result = resolveDomainAllowList(
      env({ networkMode: "restricted", allowedDomains: ["example.com", "*.internal.dev"] })
    )
    const parts = result!.split(",")
    for (const baseline of BASELINE_DOMAINS) expect(parts).toContain(baseline)
    expect(parts).toContain("example.com")
    expect(parts).toContain("*.internal.dev")
  })

  it("deduplicates a user domain that is already in the baseline", () => {
    const result = resolveDomainAllowList(
      env({ networkMode: "restricted", allowedDomains: ["github.com"] })
    )
    const occurrences = result!.split(",").filter((d) => d === "github.com")
    expect(occurrences).toHaveLength(1)
  })
})

describe("getOrCreateDefaultEnvironment", () => {
  it("propagates a non-P2002 error unchanged instead of masking it as a lost race", async () => {
    environment.findFirst.mockResolvedValueOnce(null) // no existing default
    const connectionError = new Error("connection refused")
    environment.create.mockRejectedValueOnce(connectionError)

    await expect(getOrCreateDefaultEnvironment("u1", "acme/app")).rejects.toBe(connectionError)
  })

  it("returns the winner on P2002 followed by a successful re-read", async () => {
    environment.findFirst
      .mockResolvedValueOnce(null) // no existing default: attempt create
      .mockResolvedValueOnce({
        // the re-read after losing the race
        id: "env_winner",
        name: "Default",
        repo: "acme/app",
        isDefault: true,
        networkMode: "full",
        allowedDomains: [],
        environmentVariables: null,
        setupScript: null,
      })
    environment.create.mockRejectedValueOnce(uniqueConstraintError())

    const result = await getOrCreateDefaultEnvironment("u1", "acme/app")

    expect(result.id).toBe("env_winner")
    expect(result.isDefault).toBe(true)
  })

  it("promotes a name-collision row to default when no row is marked default", async () => {
    environment.findFirst
      .mockResolvedValueOnce(null) // no existing default: attempt create
      .mockResolvedValueOnce(null) // re-read for isDefault: true finds nothing
      .mockResolvedValueOnce({
        // lookup by name finds the un-promoted collision row
        id: "env_collided",
        name: "Default",
        repo: "acme/app",
        isDefault: false,
        networkMode: "full",
        allowedDomains: [],
        environmentVariables: null,
        setupScript: null,
      })
    environment.create.mockRejectedValueOnce(uniqueConstraintError())
    environment.updateMany.mockResolvedValueOnce({ count: 0 })
    environment.update.mockResolvedValueOnce({})

    const result = await getOrCreateDefaultEnvironment("u1", "acme/app")

    expect(result.id).toBe("env_collided")
    expect(result.isDefault).toBe(true)
    expect(environment.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", repo: "acme/app", isDefault: true },
      data: { isDefault: false },
    })
    expect(environment.update).toHaveBeenCalledWith({
      where: { id: "env_collided" },
      data: { isDefault: true },
    })
  })
})

describe("toResolvedEnvironment", () => {
  it("narrows an unrecognized networkMode to full rather than trusting the column", async () => {
    const { toResolvedEnvironment } = await import("./environments")
    const resolved = toResolvedEnvironment({
      id: "e",
      name: "n",
      repo: "acme/app",
      isDefault: true,
      networkMode: "something-else",
      allowedDomains: [],
      environmentVariables: null,
      setupScript: null,
    })
    expect(resolved.networkMode).toBe("full")
  })
})

describe("toEnvironmentDTO", () => {
  it("decrypts variables, derives hasSetupScript, and serializes updatedAt as a number", async () => {
    const { toEnvironmentDTO } = await import("./environments")
    const encrypted = encryptEnvironmentVariables({ FOO: "bar" })
    const now = new Date("2026-01-01T00:00:00.000Z")

    const dto = toEnvironmentDTO({
      id: "env_1",
      name: "Default",
      repo: "acme/app",
      isDefault: true,
      networkMode: "full",
      allowedDomains: [],
      environmentVariables: encrypted,
      setupScript: "echo hi",
      setupScriptUpdatedBy: "agent",
      updatedAt: now,
    })

    expect(dto).toEqual({
      id: "env_1",
      repo: "acme/app",
      name: "Default",
      isDefault: true,
      networkMode: "full",
      allowedDomains: [],
      variables: { FOO: "bar" },
      hasSetupScript: true,
      setupScript: "echo hi",
      setupScriptUpdatedBy: "agent",
      updatedAt: now.getTime(),
    })
  })

  it("reports hasSetupScript false and setupScriptUpdatedBy null for a fresh environment", async () => {
    const { toEnvironmentDTO } = await import("./environments")
    const dto = toEnvironmentDTO({
      id: "env_2",
      name: "Default",
      repo: "acme/app",
      isDefault: true,
      networkMode: "full",
      allowedDomains: [],
      environmentVariables: null,
      setupScript: null,
      setupScriptUpdatedBy: null,
      updatedAt: new Date(),
    })

    expect(dto.hasSetupScript).toBe(false)
    expect(dto.setupScriptUpdatedBy).toBeNull()
  })

  it("narrows an unrecognized setupScriptUpdatedBy value to null", async () => {
    const { toEnvironmentDTO } = await import("./environments")
    const dto = toEnvironmentDTO({
      id: "env_3",
      name: "Default",
      repo: "acme/app",
      isDefault: true,
      networkMode: "full",
      allowedDomains: [],
      environmentVariables: null,
      setupScript: null,
      setupScriptUpdatedBy: "garbage",
      updatedAt: new Date(),
    })

    expect(dto.setupScriptUpdatedBy).toBeNull()
  })
})

describe("getOwnedEnvironment", () => {
  it("scopes the lookup to the given userId", async () => {
    const { getOwnedEnvironment } = await import("./environments")
    environment.findFirst.mockResolvedValueOnce({ id: "env_1", userId: "u1" })

    const result = await getOwnedEnvironment("u1", "env_1")

    expect(environment.findFirst).toHaveBeenCalledWith({
      where: { id: "env_1", userId: "u1" },
    })
    expect(result).toEqual({ id: "env_1", userId: "u1" })
  })

  it("returns null when the environment belongs to another user or does not exist", async () => {
    const { getOwnedEnvironment } = await import("./environments")
    environment.findFirst.mockResolvedValueOnce(null)

    const result = await getOwnedEnvironment("u1", "env_owned_by_someone_else")

    expect(result).toBeNull()
  })
})

describe("environmentUniqueConstraintMessage / violatedEnvironmentUniqueFields", () => {
  // Shapes below are copy-pasted from a real P2002 forced against the scratch
  // DB via @prisma/adapter-pg (Prisma 7.8.0), not guessed:
  //   node force_conflict.mjs  ->  meta.driverAdapterError.cause.constraint.fields
  // See task-6-report.md's smoke-test section for the full transcript.

  function p2002(fields: string[]): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields", {
      code: "P2002",
      clientVersion: "test",
      meta: {
        modelName: "Environment",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: {
            originalCode: "23505",
            kind: "UniqueConstraintViolation",
            constraint: { fields },
          },
        },
      },
    })
  }

  it("recognizes the (userId, repo, name) violation from its adapter-reported fields", async () => {
    const { violatedEnvironmentUniqueFields, environmentUniqueConstraintMessage } = await import(
      "./environments"
    )
    const error = p2002(['"userId"', "repo", "name"])

    expect(violatedEnvironmentUniqueFields(error)).toEqual(["userId", "repo", "name"])
    expect(environmentUniqueConstraintMessage(error)).toContain(
      "environment with that name already exists"
    )
  })

  it("recognizes the partial default-per-repo index violation, distinct from a name collision", async () => {
    const { violatedEnvironmentUniqueFields, environmentUniqueConstraintMessage } = await import(
      "./environments"
    )
    const error = p2002(['"userId"', "repo"])

    expect(violatedEnvironmentUniqueFields(error)).toEqual(["userId", "repo"])
    const message = environmentUniqueConstraintMessage(error)
    expect(message).not.toContain("name already exists")
    expect(message.toLowerCase()).toContain("default")
  })

  it("falls back to the classic meta.target array when no driverAdapterError is present", async () => {
    const { violatedEnvironmentUniqueFields } = await import("./environments")
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["userId", "repo", "name"] },
    })

    expect(violatedEnvironmentUniqueFields(error)).toEqual(["userId", "repo", "name"])
  })

  it("returns an empty field list when meta carries neither shape", async () => {
    const { violatedEnvironmentUniqueFields } = await import("./environments")
    const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    })

    expect(violatedEnvironmentUniqueFields(error)).toEqual([])
  })
})
