import { type BranchStatus, type AnthropicAuthType as ConstantsAnthropicAuthType } from "./constants"

export type Agent = "claude-code" | "opencode"

// SDK provider names (must match ProviderName from SDK)
export type ProviderName = "claude" | "codex" | "opencode" | "gemini"

// SDK provider mapping
export const agentToProvider: Record<Agent, ProviderName> = {
  "claude-code": "claude",
  "opencode": "opencode",
}

// Helper to get provider from agent string (handles legacy "claude" value)
export function getProviderForAgent(agent: string | undefined): ProviderName {
  if (!agent || agent === "claude" || agent === "claude-code") {
    return "claude"
  }
  if (agent === "opencode") {
    return "opencode"
  }
  // Fallback for any other value
  return "claude"
}

// Model configurations per agent
export interface ModelOption {
  value: string
  label: string
}

export const agentModels: Record<Agent, ModelOption[]> = {
  "claude-code": [
    { value: "default", label: "Default" },
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
  ],
  "opencode": [
    // Free models (limited time)
    { value: "opencode/big-pickle", label: "Big Pickle (Free)" },
    { value: "opencode/minimax-m2.5-free", label: "MiniMax M2.5 (Free)" },
    { value: "opencode/mimo-v2-flash-free", label: "MiMo v2 Flash (Free)" },
    { value: "opencode/nemotron-3-super-free", label: "Nemotron 3 Super (Free)" },
    // Anthropic models (requires Anthropic API key)
    { value: "opencode/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { value: "opencode/claude-sonnet-4", label: "Claude Sonnet 4" },
    { value: "opencode/claude-opus-4-5", label: "Claude Opus 4.5" },
    { value: "opencode/claude-haiku-4-5", label: "Claude Haiku 4.5" },
    // OpenAI models (requires OpenAI API key)
    { value: "opencode/gpt-5.4-pro", label: "GPT-5.4 Pro" },
    { value: "opencode/gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "opencode/gpt-5.1-codex", label: "GPT-5.1 Codex" },
    { value: "opencode/gpt-5", label: "GPT-5" },
  ],
}

// Default model per agent
export const defaultAgentModel: Record<Agent, string> = {
  "claude-code": "default",
  "opencode": "opencode/big-pickle",
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
