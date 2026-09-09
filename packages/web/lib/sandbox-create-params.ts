/**
 * Pure construction of the parameter object handed to `daytona.create`.
 *
 * Split out of lib/sandbox.ts so the network/env-var wiring is testable
 * without standing up a Daytona client, a prisma-backed git helper, or a live
 * snapshot lookup.
 *
 * `envVars` is omitted rather than passed as `{}` for an environment with no
 * variables, not because the SDK treats the two differently (it does
 * `env: params.envVars || {}` internally, so they're wire-identical), but
 * because omitting is simpler to read at the call site and avoids implying
 * variables were considered and found empty.
 *
 * Network restriction is NOT wired up: the installed `@daytonaio/sdk`
 * (0.170.0, pinned across the monorepo) has no `domainAllowList` field, only
 * `networkBlockAll` and a CIDR-only `networkAllowList`, neither of which can
 * express "allow these hostnames" for CDN-backed services with rotating IPs.
 * Emitting a field the SDK silently ignores would produce a sandbox that
 * looks restricted but isn't, so `"restricted"` environments are rejected
 * outright here until the SDK is upgraded (0.185.0+) and this function is
 * revisited to emit whatever field replaces `domainAllowList`.
 */

import type { CreateSandboxFromSnapshotParams } from "@daytonaio/sdk"
import { SANDBOX_CONFIG } from "@/lib/constants"
import type { ResolvedEnvironment } from "@/lib/environments"

export function buildSandboxCreateParams(args: {
  name: string
  snapshot: string
  repo: string
  branch: string
  environment: ResolvedEnvironment | null
}): CreateSandboxFromSnapshotParams {
  const { name, snapshot, repo, branch, environment } = args

  if (environment?.networkMode === "restricted") {
    throw new Error(
      `Environment "${environment.name}" (${environment.id}) is set to restricted network ` +
        `mode, but the installed @daytonaio/sdk (0.170.0) has no domain-allowlist field to ` +
        `enforce it with, only "networkBlockAll" and a CIDR-only "networkAllowList", neither ` +
        `of which can express an allowed-hostnames list. Creating this sandbox would silently ` +
        `produce an UNRESTRICTED sandbox despite the "restricted" setting, so this is refused ` +
        `instead. Set the environment's network mode to "full" until the Daytona SDK is ` +
        `upgraded to a version (0.185.0+) that supports domain allowlisting.`
    )
  }

  const envVars = environment?.variables ?? {}

  return {
    name,
    snapshot,
    autoStopInterval: 5,
    autoDeleteInterval: 5760, // 4 days - auto-delete after being stopped for four days
    public: true,
    labels: {
      [SANDBOX_CONFIG.LABEL_KEY]: "true",
      repo,
      branch,
    },
    ...(Object.keys(envVars).length > 0 && { envVars }),
  }
}
