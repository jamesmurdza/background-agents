/**
 * Pure construction of the parameter object handed to `daytona.create`.
 *
 * Split out of lib/sandbox.ts so the network/env-var wiring is testable
 * without standing up a Daytona client, a prisma-backed git helper, or a live
 * snapshot lookup. Both `domainAllowList` and `envVars` are omitted rather
 * than passed empty: Daytona treats an absent domainAllowList as
 * "unrestricted", and an empty envVars object is noise in the API call.
 */

import { SANDBOX_CONFIG } from "@/lib/constants"
import { resolveDomainAllowList, type ResolvedEnvironment } from "@/lib/environments"

export function buildSandboxCreateParams(args: {
  name: string
  snapshot: string
  repo: string
  branch: string
  environment: ResolvedEnvironment | null
}): Record<string, unknown> {
  const { name, snapshot, repo, branch, environment } = args

  const domainAllowList = environment ? resolveDomainAllowList(environment) : undefined
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
    ...(domainAllowList && { domainAllowList }),
    ...(Object.keys(envVars).length > 0 && { envVars }),
  }
}
