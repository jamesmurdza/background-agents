import { randomUUID } from "node:crypto"
import type { ProviderName, ProviderOptions, RunDefaults, RunOptions, Event } from "./types/index.js"
import { createProvider } from "./factory.js"
import type { Provider } from "./providers/base.js"
import { adaptSandbox } from "./sandbox/index.js"

const CODEAGENT_SESSION_DIR_PREFIX = "/tmp/codeagent-"

async function readProviderFromMeta(
  sandbox: Parameters<typeof adaptSandbox>[0],
  sessionDir: string
): Promise<ProviderName | null> {
  const adapted = adaptSandbox(sandbox)
  if (!adapted.executeCommand) return null
  const result = await adapted.executeCommand(
    `cat "${sessionDir}/meta.json" 2>/dev/null || true`,
    10
  )
  const raw = (result.output ?? "").trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { provider?: ProviderName }
    return o.provider ?? null
  } catch {
    return null
  }
}

/** Options for createSession (provider options + run defaults like model, timeout). */
export interface SessionOptions extends ProviderOptions {
  model?: string
  sessionId?: string
  timeout?: number
  skipInstall?: boolean
  env?: Record<string, string>
}

/** Options for createBackgroundSession (session options; paths derived from session id). */
export interface BackgroundSessionOptions extends SessionOptions {
  /** When provided, reattach to an existing background session (e.g. after restart). */
  backgroundSessionId?: string
}

/** Background session handle: start turns and get events; state lives in sandbox under session id. */
export interface BackgroundSession {
  /** Unique session id; paths and cursor in sandbox are derived from this. */
  readonly id: string
  /** Underlying provider instance (advanced use only). */
  readonly provider: Provider

  /**
   * Start a new turn with the given prompt. One log file per turn in the sandbox.
   */
  start(prompt: string, options?: Omit<RunOptions, "prompt">): Promise<{
    executionId: string
    pid: number
    outputFile: string
  }>

  /**
   * Get new events for the current turn. Cursor is read/updated in sandbox meta; no arguments.
   */
  getEvents(): Promise<{
    status: "running" | "completed"
    sessionId: string | null
    events: Event[]
    cursor: string
  }>

  /** Cancel the current turn's process in the sandbox (no-op if not running). */
  cancel(): Promise<void>
}

/**
 * Create a session: a provider with run defaults (model, timeout, env) set at creation.
 * Returns the provider; call session.run(prompt) with just the prompt string.
 */
export async function createSession(name: ProviderName, options: SessionOptions): Promise<Provider> {
  const { model, sessionId, timeout, skipInstall, env, ...providerOptions } = options
  const runDefaults: RunDefaults = { model, sessionId, timeout, skipInstall, env }
  const provider = createProvider(name, { ...providerOptions, skipInstall, env, runDefaults })
  await provider.ready
  return provider
}

/**
 * Create a background session: a provider configured for sandboxed background
 * execution with one log file per turn and meta/cursor in the sandbox.
 * Use start() to begin a turn and getEvents() to consume events (no cursor argument).
 */
export async function createBackgroundSession(
  name: ProviderName,
  options: BackgroundSessionOptions
): Promise<BackgroundSession> {
  const { backgroundSessionId, ...sessionOptions } = options
  const id = backgroundSessionId ?? randomUUID()
  return createBackgroundSessionWithId(name, { ...sessionOptions, backgroundSessionId: id }, id)
}

/** Reattach to an existing background session by id (e.g. after restart). Provider is read from sandbox meta (set on first start). */
export async function getBackgroundSession(
  options: BackgroundSessionOptions & {
    backgroundSessionId: string
    sandbox: NonNullable<BackgroundSessionOptions["sandbox"]>
  }
): Promise<BackgroundSession> {
  const { backgroundSessionId, sandbox } = options
  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${backgroundSessionId}`
  const name = await readProviderFromMeta(sandbox, sessionDir)
  if (!name) {
    throw new Error(
      "Cannot get background session: meta not found (start a turn first) or meta has no provider"
    )
  }
  return createBackgroundSessionWithId(name, options, backgroundSessionId)
}

async function createBackgroundSessionWithId(
  name: ProviderName,
  options: Omit<BackgroundSessionOptions, "backgroundSessionId"> & { backgroundSessionId?: string },
  id: string
): Promise<BackgroundSession> {
  const provider = await createSession(name, options)
  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${id}`

  return {
    id,
    provider,
    async start(prompt: string, extraOptions?: Omit<RunOptions, "prompt">) {
      return provider.startSandboxBackgroundTurn(sessionDir, {
        ...(extraOptions ?? {}),
        prompt,
      })
    },
    async getEvents() {
      return provider.getEventsSandboxBackgroundFromMeta(sessionDir)
    },
    async cancel() {
      return provider.cancelSandboxBackground(sessionDir)
    },
  }
}
