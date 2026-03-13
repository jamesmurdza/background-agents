import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

export type Agent = "claude-code" | "opencode"

// SDK provider names (must match ProviderName from SDK)
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

// SDK provider mapping
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
}

// Model configurations per agent
export interface ModelOption {
  value: string
  label: string
}

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
  ],
  "opencode": [
    { value: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "openai/gpt-4.1", label: "GPT-4.1" },
    { value: "openai/o3", label: "OpenAI o3" },
    { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "big-pickle/bp1-mini", label: "Big Pickle (Free)" },
  ],
}

// Default model per agent
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "sonnet",
  "opencode": "anthropic/claude-sonnet-4-20250514",
}

export interface ToolCall {
  id: string
  tool: string // "Read", "Edit", "Write", "Glob", "Grep", "Bash", etc.
  summary: string
  timestamp: string
}

// Content block types for interleaved rendering
export interface TextContentBlock {
  type: "text"
  text: string
}

export interface ToolCallContentBlock {
  type: "tool_calls"
  toolCalls: ToolCall[]
}

export type ContentBlock = TextContentBlock | ToolCallContentBlock

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  contentBlocks?: ContentBlock[]  // Interleaved text and tool calls in order
  timestamp: string
  commitHash?: string
  commitMessage?: string
}

export interface Branch {
  id: string
  name: string
  agent?: Agent
  model?: string
  messages: Message[]
  status: BranchStatus
  lastActivity?: string
  lastActivityTs?: number
  unread?: boolean
  sandboxId?: string
  contextId?: string
  sessionId?: string
  baseBranch: string
  startCommit?: string
  prUrl?: string
  previewUrlPattern?: string
  draftPrompt?: string
}

export interface Repo {
  id: string
  name: string
  owner: string
  avatar: string
  defaultBranch: string
  branches: Branch[]
}

export type AnthropicAuthType = ConstantsAnthropicAuthType

export interface Settings {
  githubPat: string
  anthropicApiKey: string
  anthropicAuthType: AnthropicAuthType
  anthropicAuthToken: string
  daytonaApiKey: string
}

export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "opencode": "OpenCode",
}

// Get model label from model value
export function getModelLabel(agent: Agent, modelValue: string | undefined): string {
  if (!modelValue) {
    modelValue = defaultAgentModel[agent]
  }
  const models = agentModels[agent]
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}

export const defaultSettings: Settings = {
  githubPat: "",
  anthropicApiKey: "",
  anthropicAuthType: "api-key",
  anthropicAuthToken: "",
  daytonaApiKey: "",
}
