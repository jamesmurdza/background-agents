import type { Event, ProviderName, ProviderOptions, RunOptions } from "./types/index.js"
import { createProvider } from "./factory.js"
import type { Provider } from "./providers/base.js"

/**
 * Convenience wrapper around a Provider with default run options.
 * This makes it easier to treat a provider instance as a "session".
 */
export interface SessionOptions extends ProviderOptions {
  model?: string
  sessionId?: string
  timeout?: number
  skipInstall?: boolean
  env?: Record<string, string>
}

export class Session {
  readonly name: ProviderName
  readonly provider: Provider

  private defaults: Omit<RunOptions, "prompt"> = {}

  constructor(name: ProviderName, options: SessionOptions) {
    this.name = name
    const { model, sessionId, timeout, skipInstall, env, ...providerOptions } = options
    this.provider = createProvider(name, { ...providerOptions, skipInstall, env })
    this.defaults = { model, sessionId, timeout, skipInstall, env }
  }

  getSessionId(): string | null {
    return this.provider.getSessionId()
  }

  async *run(prompt: string, overrides: Omit<RunOptions, "prompt"> = {}): AsyncGenerator<Event, void, unknown> {
    yield* this.provider.run({ ...this.defaults, ...overrides, prompt })
  }
}

export function createSession(name: ProviderName, options: SessionOptions): Session {
  return new Session(name, options)
}

