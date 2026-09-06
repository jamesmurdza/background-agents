import { describe, it, expect, vi } from "vitest"

// sandbox-create-params.ts imports resolveDomainAllowList from ./environments,
// which imports the prisma singleton. lib/db/prisma.ts constructs a
// PrismaClient at module scope and throws without DATABASE_URL, so it must be
// mocked even though nothing in this test touches it. Same pattern as
// lib/environments.test.ts.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { buildSandboxCreateParams } from "./sandbox-create-params"
import { BASELINE_DOMAINS } from "@background-agents/common"
import type { ResolvedEnvironment } from "./environments"

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

const base = {
  name: "backgrounder-abc-123",
  snapshot: "background-agents-1",
  repo: "acme/app",
  branch: "agent/1234",
}

describe("buildSandboxCreateParams", () => {
  it("omits domainAllowList in full mode", () => {
    const params = buildSandboxCreateParams({ ...base, environment: env() })
    expect(params).not.toHaveProperty("domainAllowList")
  })

  it("omits domainAllowList when there is no environment at all", () => {
    const params = buildSandboxCreateParams({ ...base, environment: null })
    expect(params).not.toHaveProperty("domainAllowList")
  })

  it("sets domainAllowList to baseline plus user domains in restricted mode", () => {
    const params = buildSandboxCreateParams({
      ...base,
      environment: env({ networkMode: "restricted", allowedDomains: ["example.com"] }),
    })
    const domains = String(params.domainAllowList).split(",")
    expect(domains).toContain("example.com")
    for (const baseline of BASELINE_DOMAINS) expect(domains).toContain(baseline)
  })

  it("passes the environment's variables as sandbox envVars", () => {
    const params = buildSandboxCreateParams({
      ...base,
      environment: env({ variables: { NPM_TOKEN: "tok" } }),
    })
    expect(params.envVars).toEqual({ NPM_TOKEN: "tok" })
  })

  it("omits envVars when the environment has none, rather than sending an empty object", () => {
    const params = buildSandboxCreateParams({ ...base, environment: env() })
    expect(params).not.toHaveProperty("envVars")
  })

  it("keeps the existing labels, snapshot, and lifecycle settings", () => {
    const params = buildSandboxCreateParams({ ...base, environment: env() })
    expect(params.snapshot).toBe("background-agents-1")
    expect(params.public).toBe(true)
    expect(params.autoStopInterval).toBe(5)
    expect(params.autoDeleteInterval).toBe(5760)
    expect(params.labels).toMatchObject({ repo: "acme/app", branch: "agent/1234" })
  })
})
