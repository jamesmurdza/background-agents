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

/** Input for the write tool (create/overwrite file). Codex may include `kind`. */
export interface WriteToolInput {
  file_path: string
  content?: string
  kind?: "add" | "update"
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/** Normalize raw provider payload into typed tool input and return a typed ToolStartEvent */
export function createToolStartEvent(name: ToolName | string, rawInput?: unknown): ToolStartEvent {
  let input: unknown = rawInput
  if (name === "write" && isObject(rawInput)) {
    const path = rawInput.file_path ?? rawInput.filePath ?? rawInput.path
    if (typeof path === "string") {
      input = {
        file_path: path,
        content: typeof rawInput.content === "string" ? rawInput.content : undefined,
        kind: rawInput.kind === "add" || rawInput.kind === "update" ? rawInput.kind : undefined,
      } satisfies WriteToolInput
    }
  } else if (name === "read" && isObject(rawInput)) {
    const path = rawInput.file_path ?? rawInput.filePath ?? rawInput.path
    if (typeof path === "string") {
      input = { file_path: path } satisfies ReadToolInput
    }
  } else if (name === "edit" && isObject(rawInput)) {
    const path = rawInput.file_path ?? rawInput.filePath ?? rawInput.path
    if (typeof path === "string") {
      input = { file_path: path, ...rawInput } as EditToolInput
    }
  } else if (name === "shell" && isObject(rawInput) && typeof rawInput.command === "string") {
    input = {
      command: rawInput.command,
      description: typeof rawInput.description === "string" ? rawInput.description : undefined,
    } satisfies ShellToolInput
  } else if (name === "glob" && isObject(rawInput) && typeof rawInput.pattern === "string") {
    input = { pattern: rawInput.pattern } satisfies GlobToolInput
  } else if (name === "grep" && isObject(rawInput) && typeof rawInput.pattern === "string") {
    input = {
      pattern: rawInput.pattern,
      path: typeof rawInput.path === "string" ? rawInput.path : undefined,
    } satisfies GrepToolInput
  }
  return { type: "tool_start", name, input } as ToolStartEvent
}

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
}

/** Union type of all possible events */
export type Event =
  | SessionEvent
  | TokenEvent
  | ToolStartEvent
  | ToolDeltaEvent
  | ToolEndEvent
  | EndEvent

/** Event type discriminator */
export type EventType = Event["type"]
