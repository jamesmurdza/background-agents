export type Agent = "claude-code"

export interface ToolCall {
  id: string
  tool: string // "Read", "Edit", "Write", "Glob", "Grep", "Bash", etc.
  summary: string
  timestamp: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
  timestamp: string
  commitHash?: string
  commitMessage?: string
}

export interface Branch {
  id: string
  name: string
  agent: Agent
  messages: Message[]
  status: "idle" | "running" | "creating" | "error" | "stopped"
  lastActivity: string
  lastActivityTs?: number
  unread?: boolean
  sandboxId?: string
  contextId?: string
  sessionId?: string
  baseBranch: string
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

export type AnthropicAuthType = "api-key" | "claude-max"

export interface Settings {
  githubPat: string
  anthropicApiKey: string
  anthropicAuthType: AnthropicAuthType
  anthropicAuthToken: string
  daytonaApiKey: string
}

export const agentLabels: Record<Agent, string> = {
  "claude-code": "Claude Code",
}

export const defaultSettings: Settings = {
  githubPat: "",
  anthropicApiKey: "",
  anthropicAuthType: "api-key",
  anthropicAuthToken: "",
  daytonaApiKey: "",
}
