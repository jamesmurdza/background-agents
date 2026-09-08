import { describe, it, expect, vi } from "vitest"

// sandbox-create-params.ts imports ResolvedEnvironment from ./environments,
// which imports the prisma singleton. lib/db/prisma.ts constructs a
// PrismaClient at module scope and throws without DATABASE_URL, so it must be
// mocked even though nothing in this test touches it. Same pattern as
// lib/environments.test.ts.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { buildSandboxCreateParams } from "./sandbox-create-params"
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
  it("emits no network-restriction field in full mode", () => {
    const params = buildSandboxCreateParams({ ...base, environment: env() })
    expect(params).not.toHaveProperty("domainAllowList")
    expect(params).not.toHaveProperty("networkAllowList")
    expect(params).not.toHaveProperty("networkBlockAll")
  })

  it("emits no network-restriction field when there is no environment at all", () => {
    const params = buildSandboxCreateParams({ ...base, environment: null })
    expect(params).not.toHaveProperty("domainAllowList")
    expect(params).not.toHaveProperty("networkAllowList")
    expect(params).not.toHaveProperty("networkBlockAll")
  })

  // The installed @daytonaio/sdk (0.170.0) has no domain-allowlist field,
  // only networkBlockAll and a CIDR-only networkAllowList, neither of which
  // can express "allow these hostnames" for CDN-backed services with
  // rotating IPs. Emitting a field the SDK ignores would silently produce an
  // unrestricted sandbox despite the "restricted" setting, so restricted mode
  // is refused outright rather than under-enforced.
  it("throws for restricted mode, since the installed Daytona SDK cannot enforce a domain allowlist", () => {
    expect(() =>
      buildSandboxCreateParams({
        ...base,
        environment: env({ networkMode: "restricted", allowedDomains: ["example.com"] }),
      })
    ).toThrow(/restricted network/i)
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
