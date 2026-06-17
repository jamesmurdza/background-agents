/**
 * Event types emitted by AI coding agents
 */

/** Session started event - contains the session ID for resumption */
export interface SessionEvent {
  type: "session"
  id: string
}

/** Token event - a text token from the assistant's response */
export interface TokenEvent {
  type: "token"
  text: string
}

/** Normalized tool names (same across Claude, Codex, etc.) */
export type ToolName = "write" | "read" | "edit" | "glob" | "grep" | "shell"

/** Input for the write tool (create/overwrite file). Canonical: always include kind + content (nullable). */
export interface WriteToolInput {
  file_path: string
  content: string | null
  kind: "add" | "update"
}

/** Input for the read tool (path to file). Canonical: always file_path. */
export interface ReadToolInput {
  file_path: string
}

/** Input for the edit tool (patch/edit file). Canonical: file_path + optional rest. */
export interface EditToolInput {
  file_path: string
  [key: string]: unknown
}

/** Input for the glob tool (file search by pattern). */
export interface GlobToolInput {
  pattern: string
}

/** Input for the grep tool (content search). */
export interface GrepToolInput {
  pattern: string
  path?: string
}

/** Input for the shell tool (run a command). */
export interface ShellToolInput {
  command: string
  description?: string
}

/** Tool input map for narrowing by tool name */
export interface ToolInputMap {
  write: WriteToolInput
  read: ReadToolInput
  edit: EditToolInput
  glob: GlobToolInput
  grep: GrepToolInput
  shell: ShellToolInput
}

/** Tool start event – discriminated by name for typed input */
export type ToolStartEvent =
  | { type: "tool_start"; name: "write"; input?: WriteToolInput }
  | { type: "tool_start"; name: "read"; input?: ReadToolInput }
  | { type: "tool_start"; name: "edit"; input?: EditToolInput }
  | { type: "tool_start"; name: "glob"; input?: GlobToolInput }
  | { type: "tool_start"; name: "grep"; input?: GrepToolInput }
  | { type: "tool_start"; name: "shell"; input?: ShellToolInput }
  | { type: "tool_start"; name: string; input?: unknown }

/** Tool delta event - partial input being streamed to a tool */
export interface ToolDeltaEvent {
  type: "tool_delta"
  text: string
}

/** Tool end event - indicates tool invocation is complete */
export interface ToolEndEvent {
  type: "tool_end"
  /** Tool result/output when provided by the CLI */
  output?: string
}

/** End event - indicates the message/turn is complete */
export interface EndEvent {
  type: "end"
  /** When the CLI failed (e.g. error_during_execution), the error message if available */
  error?: string
}

/** Agent crashed event - process exited without emitting end (e.g. crash or kill) */
export interface AgentCrashedEvent {
  type: "agent_crashed"
  message?: string
  /** Raw tail of stdout/stderr before exit (often not valid JSONL; use for debugging only) */
  output?: string
}

/** Union type of all possible events */
export type Event =
  | SessionEvent
  | TokenEvent
  | ToolStartEvent
  | ToolDeltaEvent
  | ToolEndEvent
  | EndEvent
  | AgentCrashedEvent

/** Event type discriminator */
export type EventType = Event["type"]
