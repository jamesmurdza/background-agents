import type { ThinkingCapability } from "@background-agents/sdk/thinking"
import { supportsThinking } from "@background-agents/sdk/thinking"

export interface ThinkingRecoveryRequest {
  id: string
  chatId: string
  content: string
  agent: string
  model: string
  originalAgent?: string
  originalModel?: string
  originalThinking: string
  files?: File[]
  planMode?: boolean
  rejectedMessageId?: string
  sourceMessageId?: string
  /** Historical uploaded files cannot be recreated as browser File objects. */
  missingAttachments?: string[]
}

export function requiresThinkingRecovery(
  original: { agent?: string; model?: string },
  target: { agent: string; model: string },
): boolean {
  // Do not infer historical ownership from mutable chat/composer settings.
  return !original.agent || !original.model || original.agent !== target.agent || original.model !== target.model
}

export function recoveryTargetKey(request: Pick<ThinkingRecoveryRequest, "id" | "chatId" | "agent" | "model">): string {
  return JSON.stringify([request.id, request.chatId, request.agent, request.model])
}

export interface ThinkingRecoveryChoice { targetKey: string; thinking: string }

export function canConfirmThinkingRecovery(
  request: ThinkingRecoveryRequest,
  choice: ThinkingRecoveryChoice | undefined,
  capability: ThinkingCapability,
  ready: boolean,
): boolean {
  return ready && !!choice && choice.targetKey === recoveryTargetKey(request) && supportsThinking(capability, choice.thinking)
}
