/**
 * Sandbox module: public API and adapter dispatch.
 * Implementations live in sandbox/daytona.ts and daytona-ssh.ts.
 */
import type { CodeAgentSandbox, AdaptSandboxOptions } from "../types/index"
import { adaptDaytonaSandbox } from "./daytona"
export type { CodeAgentSandbox, AdaptSandboxOptions } from "../types/index"
export { adaptDaytonaSandbox } from "./daytona"

/**
 * Adapt a sandbox for use with createProvider/createSession.
 * If the value is a Daytona Sandbox (from @daytonaio/sdk), it is wrapped via the Daytona adapter.
 * Otherwise it must already implement CodeAgentSandbox and is returned as-is.
 */
export function adaptSandbox(
  sandbox: CodeAgentSandbox | import("@daytonaio/sdk").Sandbox,
  options: AdaptSandboxOptions = {}
): CodeAgentSandbox {
  const s = sandbox as CodeAgentSandbox & { process?: unknown; delete?: unknown }
  if ("process" in s && typeof s.delete === "function") {
    return adaptDaytonaSandbox(sandbox as import("@daytonaio/sdk").Sandbox, options)
  }
  return sandbox as CodeAgentSandbox
}
