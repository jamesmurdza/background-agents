/**
 * Named timeouts for E2E tests so intent is clear and values are consistent.
 */
export const TIMEOUT = {
  /** App loads, no redirect to login */
  PAGE_LOAD: 10_000,
  /** Branch button appears in sidebar */
  SIDEBAR_READY: 15_000,
  /** Textarea / UI element becomes interactive */
  UI_READY: 10_000,
  /** "Agent is working..." indicator appears after send */
  AGENT_START: 30_000,
  /** Streaming content begins arriving */
  CONTENT_STREAM: 60_000,
  /** Tool calls appear in the timeline */
  TOOL_CALLS: 90_000,
  /** Agent finishes (working indicator hidden / API says completed) */
  AGENT_COMPLETE: 60_000,
  /** Content survives a refresh or branch switch */
  POST_REFRESH: 15_000,
}
