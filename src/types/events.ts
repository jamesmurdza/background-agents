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

/** Tool start event - indicates a tool is being invoked */
export interface ToolStartEvent {
  type: "tool_start"
  name: string
}

/** Tool delta event - partial input being streamed to a tool */
export interface ToolDeltaEvent {
  type: "tool_delta"
  text: string
}

/** Tool end event - indicates tool invocation is complete */
export interface ToolEndEvent {
  type: "tool_end"
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
