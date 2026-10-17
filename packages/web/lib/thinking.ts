import { agentToProvider, type Agent } from "@background-agents/common"
import { getThinkingCapability, getVerifiedThinkingCapability, validateThinking } from "@background-agents/sdk/thinking"

export function thinkingCapability(agent: string, model: string) {
  return getThinkingCapability(agentToProvider[agent as Agent] ?? agent, model)
}

/** Browser-safe, evidence-backed initial choices; launch still verifies runtime support. */
export function verifiedThinkingCapability(agent: string, model: string) {
  return getVerifiedThinkingCapability(agentToProvider[agent as Agent] ?? agent, model)
}

export function parseThinking(agent: string, model: string, value: unknown) {
  return validateThinking(agentToProvider[agent as Agent] ?? agent, model, value)
}
