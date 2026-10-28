import { getEnvForModel, type CustomEndpoint } from "@background-agents/common"
import type { Agent } from "@/lib/agent-session"
import type { Credentials } from "@/lib/credentials"
import type { MessagePayload } from "./types"

/**
 * Build the environment passed to the agent process: the model/agent system env
 * merged with the user's env vars (see loadUserEnvVars in
 * lib/server/user-env-vars). User vars take precedence over system vars.
 */
export function buildAgentEnv(params: {
  payload: MessagePayload
  credentials: Credentials
  customEndpoints?: CustomEndpoint[]
  userEnv: Record<string, string>
}): Record<string, string> {
  const { payload, credentials, customEndpoints, userEnv } = params
  const systemEnv = getEnvForModel(payload.model, payload.agent as Agent, credentials, customEndpoints)
  return { ...systemEnv, ...userEnv }
}
