import { randomUUID } from "node:crypto"
import type { ProviderName, ProviderOptions, RunDefaults, RunOptions, Event } from "./types/index.js"
import { debugLog } from "./debug.js"
import { createProvider } from "./factory.js"
import type { Provider } from "./providers/base.js"
import { adaptSandbox } from "./sandbox/index.js"

const CODEAGENT_SESSION_DIR_PREFIX = "/tmp/codeagent-"

/** Cache reattached background sessions by id so status/getEvents polls don't recreate the provider every time. */
const backgroundSessionCache = new Map<string, BackgroundSession>()

async function readProviderFromMeta(
  sandbox: Parameters<typeof adaptSandbox>[0],
  sessionDir: string
): Promise<{ provider: ProviderName | null; sessionId: string | null } | null> {
  const adapted = adaptSandbox(sandbox)
  if (!adapted.executeCommand) return null
  const result = await adapted.executeCommand(
    `cat "${sessionDir}/meta.json" 2>/dev/null || true`,
    10
  )
  const raw = (result.output ?? "").trim()
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as { provider?: ProviderName; sessionId?: string | null }
    return {
      provider: o.provider ?? null,
      sessionId: o.sessionId ?? null,
    }
  } catch {
    return { provider: null, sessionId: null }
  }
}

/** Options for createSession (provider options + run defaults like model, timeout). */
export interface SessionOptions extends ProviderOptions {
  model?: string
  sessionId?: string
  timeout?: number
  /** Optional system prompt applied once per session. */
  systemPrompt?: string
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
   * Use isRunning() to check if the agent is still running (or crashed).
   */
  getEvents(): Promise<{
    sessionId: string | null
    events: Event[]
    cursor: string
    running: boolean
  }>

  /** True if the current turn's process is still running in the sandbox (e.g. detect crash). */
  isRunning(): Promise<boolean>

  /** Current turn's process id from sandbox meta, or null if no run in progress. */
  getPid(): Promise<number | null>

  /** Cancel the current turn's process in the sandbox (no-op if not running). */
  cancel(): Promise<void>
}

/**
 * Create a session: a provider with run defaults (model, timeout, env) set at creation.
 * Returns the provider; call session.run(prompt) with just the prompt string.
 */
export async function createSession(name: ProviderName, options: SessionOptions): Promise<Provider> {
  debugLog("createSession", options.sessionId, name)
  const { model, sessionId, timeout, systemPrompt, skipInstall, env, ...providerOptions } = options

  // Store session-level env in runDefaults (medium precedence)
  // Don't pass env directly to provider (that was causing double-passing bug)
  const runDefaults: RunDefaults = { model, sessionId, timeout, systemPrompt, skipInstall, env }
  const provider = createProvider(name, { ...providerOptions, skipInstall, runDefaults })

  await provider.ready
  debugLog("createSession ready", options.sessionId, name)
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
  debugLog("createBackgroundSession", options.sessionId, name, "id=" + id)
  return createBackgroundSessionWithId(name, { ...sessionOptions, backgroundSessionId: id }, id)
}

/** Reattach to an existing background session by id (e.g. after restart). Provider is read from sandbox meta (written at session creation). Cached per id so repeated polls don't recreate the provider. */
export async function getBackgroundSession(
  options: BackgroundSessionOptions & {
    backgroundSessionId: string
    sandbox: NonNullable<BackgroundSessionOptions["sandbox"]>
  }
): Promise<BackgroundSession> {
  const { backgroundSessionId, sandbox } = options
  const cached = backgroundSessionCache.get(backgroundSessionId)
  if (cached) {
    debugLog("getBackgroundSession", cached.provider.sessionId, "id=" + backgroundSessionId, "cached")
    return cached
  }
  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${backgroundSessionId}`
  debugLog("getBackgroundSession", undefined, "id=" + backgroundSessionId, "sessionDir=" + sessionDir)
  const meta = await readProviderFromMeta(sandbox, sessionDir)
  if (!meta?.provider) {
    debugLog("getBackgroundSession meta missing or no provider", meta?.sessionId ?? undefined, backgroundSessionId)
    throw new Error(
      "Cannot get background session: meta not found (start a turn first) or meta has no provider"
    )
  }
  debugLog("getBackgroundSession reattach provider=" + meta.provider, meta.sessionId)
  return createBackgroundSessionWithId(
    meta.provider,
    {
      ...options,
      // Seed sessionId so providers that support resume (e.g. Claude) can continue the same session.
      sessionId: meta.sessionId ?? options.sessionId,
    },
    backgroundSessionId,
    { skipWriteInitialMeta: true }
  )
}

async function createBackgroundSessionWithId(
  name: ProviderName,
  options: Omit<BackgroundSessionOptions, "backgroundSessionId"> & { backgroundSessionId?: string },
  id: string,
  opts?: { skipWriteInitialMeta?: boolean }
): Promise<BackgroundSession> {
  const provider = await createSession(name, options)
  const sessionDir = `${CODEAGENT_SESSION_DIR_PREFIX}${id}`
  if (!opts?.skipWriteInitialMeta) {
    await provider.writeInitialSessionMeta(sessionDir)
  }

  const session: BackgroundSession = {
    id,
    provider,
    async start(prompt: string, extraOptions?: Omit<RunOptions, "prompt">) {
      debugLog("BackgroundSession.start", provider.sessionId, "id=" + id, "sessionDir=" + sessionDir, "promptLength=" + prompt.length)
      const result = await provider.startSandboxBackgroundTurn(sessionDir, {
        // Re-apply core run defaults (model, timeout, env, systemPrompt) for each turn.
        model: options.model,
        timeout: options.timeout,
        env: options.env,
        systemPrompt: options.systemPrompt,
        sessionId: options.sessionId,
        ...(extraOptions ?? {}),
        prompt,
      })
      debugLog("BackgroundSession.start returned", provider.sessionId, "id=" + id, "pid=" + result.pid, "outputFile=" + result.outputFile)
      return result
    },
    async getEvents() {
      return provider.getEventsSandboxBackgroundFromMeta(sessionDir)
    },
    async isRunning() {
      return provider.isSandboxBackgroundProcessRunning(sessionDir)
    },
    async getPid() {
      return provider.getSandboxBackgroundPid(sessionDir)
    },
    async cancel() {
      return provider.cancelSandboxBackground(sessionDir)
    },
  }
  backgroundSessionCache.set(id, session)
  return session
}
