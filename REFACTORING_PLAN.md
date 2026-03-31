# Comprehensive Refactoring Plan: @upstream/agents Package

## Executive Summary

Based on extensive testing of Daytona SDK execution methods and analysis of the current agents package, this plan proposes a comprehensive refactoring to improve reliability, simplify architecture, and leverage proven patterns from our background execution tests.

---

## Current State Analysis

### What Works Well
- **Event normalization**: Unified event types across Claude, Codex, OpenCode, Gemini
- **Tool name canonicalization**: All providers map to `write`, `read`, `edit`, `glob`, `grep`, `shell`
- **Provider abstraction**: Clean interface for adding new providers
- **Two execution modes**: Streaming (PTY) and Background (SSH polling)

### Pain Points Identified

1. **SSH-only background execution**: Current implementation requires SSH for async, but our tests show `executeCommand` with `nohup` works just as well and is simpler.

2. **PTY buffering issues**: CLI tools that buffer output without TTY cause problems. Our tests discovered `script -q -c` as a reliable workaround.

3. **Process state detection**: Current `kill -0` check returns true for zombie processes. Need proper state checking via `ps -p PID -o state=`.

4. **No executeSessionCommand support**: The SDK's `runAsync: true` pattern with PTY simulation isn't utilized.

5. **Environment handling complexity**: Three-level precedence (session/run/command) is confusing and error-prone.

6. **Tight coupling**: Sandbox adapter, provider, and session management are deeply intertwined.

7. **Limited kill robustness**: Single `kill` command often fails for process trees.

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         @upstream/agents                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   Session API   │    │  Background API │    │   Direct API    │  │
│  │   (Streaming)   │    │   (Polling)     │    │   (One-shot)    │  │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘  │
│           │                      │                      │           │
│           └──────────────────────┼──────────────────────┘           │
│                                  │                                   │
│                    ┌─────────────▼─────────────┐                    │
│                    │    Execution Engine       │                    │
│                    │  (4 methods supported)    │                    │
│                    └─────────────┬─────────────┘                    │
│                                  │                                   │
│    ┌─────────────────────────────┼─────────────────────────────────┐│
│    │                             │                                 ││
│    ▼                             ▼                                 ▼│
│  ┌────────┐  ┌────────────────┐  ┌───────────────────┐  ┌────────┐ │
│  │  SSH   │  │ executeCommand │  │executeSessionCmd  │  │  PTY   │ │
│  │ nohup  │  │    + nohup     │  │   + runAsync      │  │ stream │ │
│  └────────┘  └────────────────┘  └───────────────────┘  └────────┘ │
│                                                                      │
│                    ┌─────────────▼─────────────┐                    │
│                    │    Process Manager        │                    │
│                    │  • isRunning (proper)     │                    │
│                    │  • kill (robust)          │                    │
│                    │  • poll output            │                    │
│                    └─────────────┬─────────────┘                    │
│                                  │                                   │
│                    ┌─────────────▼─────────────┐                    │
│                    │    Provider Registry      │                    │
│                    │  • Claude                 │                    │
│                    │  • Codex                  │                    │
│                    │  • OpenCode               │                    │
│                    │  • Gemini                 │                    │
│                    └───────────────────────────┘                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Execution Engine Refactor

### 1.1 New ExecutionMethod Enum

```typescript
// src/types/execution.ts
export type ExecutionMethod =
  | "ssh"              // SSH + nohup (current default)
  | "executeCommand"   // sandbox.process.executeCommand + nohup
  | "sessionCommand"   // sandbox.process.executeSessionCommand + runAsync + script
  | "pty"              // PTY streaming (blocking)

export interface ExecutionOptions {
  method?: ExecutionMethod
  timeout?: number
  outputFile?: string
  usePtySimulation?: boolean  // Use `script -q -c` for CLI tools
}
```

### 1.2 Unified Execution Adapter

```typescript
// src/execution/adapter.ts
export interface ExecutionResult {
  pid: number
  outputFile: string
  method: ExecutionMethod
}

export interface ExecutionAdapter {
  // Start a background process
  start(command: string, options: ExecutionOptions): Promise<ExecutionResult>

  // Check if process is actually running (not zombie)
  isRunning(pid: number): Promise<boolean>

  // Get process state: running | sleeping | zombie | stopped | dead
  getProcessState(pid: number): Promise<ProcessState>

  // Kill process robustly (TERM → KILL → pkill)
  kill(pid: number, processName?: string): Promise<boolean>

  // Poll output file for new content
  pollOutput(outputFile: string, cursor: number): Promise<PollResult>

  // Check if .done marker file exists
  isDone(outputFile: string): Promise<boolean>
}
```

### 1.3 Implement Four Execution Methods

```typescript
// src/execution/methods/ssh.ts
export class SshExecutor implements ExecutionAdapter {
  // Current SSH-based implementation, cleaned up
}

// src/execution/methods/execute-command.ts
export class ExecuteCommandExecutor implements ExecutionAdapter {
  async start(command: string, options: ExecutionOptions): Promise<ExecutionResult> {
    const outputFile = options.outputFile ?? `/tmp/agent-${Date.now()}.jsonl`
    const wrapper = `nohup sh -c '${escapeShell(command)} >> ${outputFile} 2>&1; echo 1 > ${outputFile}.done' > /dev/null 2>&1 & echo $!`
    const result = await this.sandbox.process.executeCommand(wrapper, undefined, this.env, 30)
    const pid = parseInt(result.result?.trim() || "0")
    return { pid, outputFile, method: "executeCommand" }
  }
}

// src/execution/methods/session-command.ts
export class SessionCommandExecutor implements ExecutionAdapter {
  async start(command: string, options: ExecutionOptions): Promise<ExecutionResult> {
    const outputFile = options.outputFile ?? `/tmp/agent-${Date.now()}.jsonl`

    // Use script -q -c for PTY simulation (required for CLI tools that buffer without TTY)
    const wrappedCommand = options.usePtySimulation
      ? `(script -q -c "${escapeShell(command)}" ${outputFile}; echo 1 > ${outputFile}.done) & echo $! > ${outputFile}.pid`
      : `(${command} >> ${outputFile} 2>&1; echo 1 > ${outputFile}.done) & echo $! > ${outputFile}.pid`

    await this.sandbox.process.executeSessionCommand(this.sessionId, {
      command: wrappedCommand,
      runAsync: true,
    }, 30)

    // Read PID from file
    await sleep(200)
    const pidResult = await this.sandbox.process.executeCommand(`cat ${outputFile}.pid`)
    const pid = parseInt(pidResult.result?.trim() || "0")
    return { pid, outputFile, method: "sessionCommand" }
  }
}

// src/execution/methods/pty.ts
export class PtyExecutor implements ExecutionAdapter {
  // For streaming mode - returns events as they come
  async *stream(command: string, options: ExecutionOptions): AsyncGenerator<string> {
    // Current PTY implementation with improvements
  }
}
```

---

## Phase 2: Process Manager Refactor

### 2.1 Robust Process State Detection

```typescript
// src/execution/process-manager.ts
export type ProcessState = "running" | "sleeping" | "disk_sleep" | "stopped" | "zombie" | "dead"

export class ProcessManager {
  constructor(private sandbox: Sandbox) {}

  async getState(pid: number): Promise<ProcessState> {
    // Check actual process state, not just PID existence
    const result = await this.sandbox.process.executeCommand(
      `ps -p ${pid} -o state= 2>/dev/null || echo "X"`
    )
    const state = result.result?.trim() || "X"

    const stateMap: Record<string, ProcessState> = {
      "R": "running",
      "S": "sleeping",
      "D": "disk_sleep",
      "T": "stopped",
      "Z": "zombie",
      "X": "dead",
      "": "dead"
    }
    return stateMap[state] ?? "dead"
  }

  async isActuallyRunning(pid: number): Promise<boolean> {
    const state = await this.getState(pid)
    return state !== "zombie" && state !== "dead"
  }

  async kill(pid: number, options?: KillOptions): Promise<boolean> {
    // Step 1: Try graceful SIGTERM
    await this.sandbox.process.executeCommand(`kill -TERM ${pid} 2>/dev/null || true`)
    await sleep(500)

    if (await this.isActuallyRunning(pid)) {
      // Step 2: Try process group kill
      await this.sandbox.process.executeCommand(`kill -TERM -${pid} 2>/dev/null || true`)
      await sleep(500)
    }

    if (await this.isActuallyRunning(pid)) {
      // Step 3: Force kill
      await this.sandbox.process.executeCommand(`kill -9 ${pid} 2>/dev/null || true`)
      await this.sandbox.process.executeCommand(`kill -9 -${pid} 2>/dev/null || true`)
      await sleep(300)
    }

    if (options?.processName && await this.isActuallyRunning(pid)) {
      // Step 4: pkill as last resort
      await this.sandbox.process.executeCommand(`pkill -9 -f "${options.processName}" 2>/dev/null || true`)
      await sleep(300)
    }

    return !await this.isActuallyRunning(pid)
  }
}
```

---

## Phase 3: Simplified Environment Handling

### 3.1 Single-Level Environment

Replace the confusing three-level precedence with a simpler model:

```typescript
// src/types/environment.ts
export interface EnvironmentConfig {
  // Base environment (set at session creation)
  base: Record<string, string>

  // Per-run overrides (merged on each run, cleared after)
  overrides?: Record<string, string>
}

// Usage
const session = await createSession("claude", {
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  }
})

// Per-run override
await session.run("prompt", {
  env: { CUSTOM_VAR: "value" }  // Merged with base for this run only
})
```

### 3.2 Provider-Specific Environment Injection

```typescript
// src/providers/base.ts
abstract class Provider {
  // Each provider declares required env vars
  abstract getRequiredEnvVars(): string[]

  // Validate before execution
  validateEnvironment(env: Record<string, string>): void {
    const missing = this.getRequiredEnvVars().filter(v => !env[v])
    if (missing.length) {
      throw new Error(`Missing required environment variables: ${missing.join(", ")}`)
    }
  }
}

// src/providers/claude.ts
class ClaudeProvider extends Provider {
  getRequiredEnvVars() { return ["ANTHROPIC_API_KEY"] }
}

// src/providers/codex.ts
class CodexProvider extends Provider {
  getRequiredEnvVars() { return ["OPENAI_API_KEY"] }
}
```

---

## Phase 4: Provider Interface Cleanup

### 4.1 Simplified Provider Interface

```typescript
// src/types/provider.ts
export interface IProvider {
  readonly name: ProviderName
  readonly sessionId: string | null

  // Build CLI command
  buildCommand(options: RunOptions): ProviderCommand

  // Parse single JSONL line to events
  parse(line: string): Event | Event[] | null

  // Provider-specific CLI flags
  getCliFlags(options: RunOptions): string[]

  // Required env vars for this provider
  getRequiredEnvVars(): string[]

  // Post-install hook (e.g., Gemini mkdir)
  postInstall?(): Promise<void>
}
```

### 4.2 Remove Execution Logic from Providers

Move execution logic out of providers into the execution engine:

```typescript
// BEFORE (current): Execution mixed into Provider base class
class Provider {
  async *runSandbox(options) { /* PTY logic */ }
  async startSandboxBackground(sessionDir, options) { /* SSH logic */ }
  async pollSandboxBackground(outputFile, cursor) { /* polling logic */ }
}

// AFTER: Provider is pure command/parse logic
class Provider {
  buildCommand(options: RunOptions): ProviderCommand
  parse(line: string): Event | Event[] | null
}

// Execution handled separately
class AgentRunner {
  constructor(
    private provider: IProvider,
    private executor: ExecutionAdapter,
    private processManager: ProcessManager
  ) {}

  async *stream(options: RunOptions): AsyncGenerator<Event> {
    const command = this.provider.buildCommand(options)
    for await (const line of this.executor.stream(command.fullCommand)) {
      const events = this.provider.parse(line)
      if (events) yield* Array.isArray(events) ? events : [events]
    }
  }

  async startBackground(options: RunOptions): Promise<BackgroundHandle> {
    const command = this.provider.buildCommand(options)
    const result = await this.executor.start(command.fullCommand, {
      usePtySimulation: true  // Required for CLI tools
    })
    return new BackgroundHandle(result, this.provider, this.processManager)
  }
}
```

---

## Phase 5: Background Session Redesign

### 5.1 Simplified BackgroundSession

```typescript
// src/session/background.ts
export interface BackgroundSession {
  readonly id: string
  readonly pid: number
  readonly outputFile: string

  // Poll for new events since last call
  poll(): Promise<PollResult>

  // Check if still running
  isRunning(): Promise<boolean>

  // Get detailed process state
  getState(): Promise<ProcessState>

  // Kill the process
  kill(): Promise<boolean>

  // Resume from cursor (for reconnection)
  resume(cursor: string): void
}

export interface PollResult {
  events: Event[]
  cursor: string
  done: boolean
  state: ProcessState
}
```

### 5.2 State Persistence

```typescript
// src/session/state.ts
export interface SessionState {
  id: string
  provider: ProviderName
  pid: number
  outputFile: string
  cursor: string
  providerSessionId: string | null
  createdAt: number
  lastPollAt: number
}

export class SessionStore {
  constructor(private sandbox: Sandbox, private basePath = "/tmp/agent-sessions") {}

  async save(state: SessionState): Promise<void> {
    const path = `${this.basePath}/${state.id}/state.json`
    await this.sandbox.process.executeCommand(`mkdir -p ${this.basePath}/${state.id}`)
    await this.sandbox.process.executeCommand(`cat > ${path} << 'EOF'\n${JSON.stringify(state, null, 2)}\nEOF`)
  }

  async load(id: string): Promise<SessionState | null> {
    const path = `${this.basePath}/${id}/state.json`
    const result = await this.sandbox.process.executeCommand(`cat ${path} 2>/dev/null || echo ""`)
    if (!result.result?.trim()) return null
    return JSON.parse(result.result)
  }

  async list(): Promise<string[]> {
    const result = await this.sandbox.process.executeCommand(`ls ${this.basePath} 2>/dev/null || echo ""`)
    return result.result?.trim().split("\n").filter(Boolean) ?? []
  }
}
```

---

## Phase 6: API Simplification

### 6.1 New Top-Level API

```typescript
// src/index.ts

// Simple one-shot execution
export async function run(
  provider: ProviderName,
  prompt: string,
  options: RunOptions
): Promise<RunResult> {
  const session = await createSession(provider, options)
  const events: Event[] = []
  for await (const event of session.run(prompt)) {
    events.push(event)
  }
  return { events, sessionId: session.sessionId }
}

// Streaming execution
export async function* stream(
  provider: ProviderName,
  prompt: string,
  options: RunOptions
): AsyncGenerator<Event> {
  const session = await createSession(provider, options)
  yield* session.run(prompt)
}

// Background execution with polling
export async function startBackground(
  provider: ProviderName,
  prompt: string,
  options: BackgroundOptions
): Promise<BackgroundSession> {
  const session = await createBackgroundSession(provider, options)
  await session.start(prompt)
  return session
}

// Reconnect to existing background session
export async function reconnectBackground(
  id: string,
  options: ReconnectOptions
): Promise<BackgroundSession> {
  return getBackgroundSession({ ...options, backgroundSessionId: id })
}
```

### 6.2 Execution Method Selection

```typescript
// src/session.ts
export interface BackgroundOptions extends SessionOptions {
  // Choose execution method (default: "executeCommand" for simplicity)
  executionMethod?: ExecutionMethod
}

export async function createBackgroundSession(
  provider: ProviderName,
  options: BackgroundOptions
): Promise<BackgroundSession> {
  const method = options.executionMethod ?? "executeCommand"  // New default

  const executor = createExecutor(method, options.sandbox)
  const processManager = new ProcessManager(options.sandbox)
  const providerInstance = createProvider(provider, options)

  // ...
}
```

---

## Phase 7: Testing Strategy

### 7.1 Unit Tests for Each Execution Method

```typescript
// tests/execution/execute-command.test.ts
describe("ExecuteCommandExecutor", () => {
  it("starts process and returns PID immediately", async () => {
    const result = await executor.start("sleep 10", {})
    expect(result.pid).toBeGreaterThan(0)
    expect(result.outputFile).toContain(".jsonl")
  })

  it("detects running process correctly", async () => {
    const { pid } = await executor.start("sleep 10", {})
    expect(await executor.isRunning(pid)).toBe(true)
  })

  it("kills process reliably", async () => {
    const { pid } = await executor.start("sleep 100", {})
    expect(await executor.kill(pid)).toBe(true)
    expect(await executor.isRunning(pid)).toBe(false)
  })
})
```

### 7.2 Integration Tests for Each Provider × Method

```typescript
// tests/integration/matrix.test.ts
const providers: ProviderName[] = ["claude", "codex", "opencode", "gemini"]
const methods: ExecutionMethod[] = ["ssh", "executeCommand", "sessionCommand", "pty"]

describe.each(providers)("Provider: %s", (provider) => {
  describe.each(methods)("Method: %s", (method) => {
    it("produces valid events", async () => {
      const session = await createBackgroundSession(provider, {
        sandbox,
        executionMethod: method,
        env: getEnvForProvider(provider),
      })
      await session.start("say hello")

      // Poll until done
      let events: Event[] = []
      while (true) {
        const result = await session.poll()
        events.push(...result.events)
        if (result.done) break
        await sleep(1000)
      }

      expect(events.some(e => e.type === "end")).toBe(true)
    })
  })
})
```

---

## Migration Guide

### Breaking Changes

1. **`executeBackground` option removed** from sandbox adapter
   - Use `executionMethod` option instead

2. **Environment precedence simplified**
   - `setSessionEnvVars` / `setRunEnvVars` → just `env` option
   - No more implicit merging confusion

3. **`runSandbox` / `startSandboxBackground` removed from Provider**
   - Use `AgentRunner` class instead
   - Providers are now pure command/parse logic

### Migration Steps

```typescript
// BEFORE
const session = await createBackgroundSession("claude", {
  sandbox: adaptDaytonaSandbox(sandbox),
  env: { ANTHROPIC_API_KEY: key },
})
await session.start(prompt)
const { events } = await session.getEvents()

// AFTER
const session = await createBackgroundSession("claude", {
  sandbox,
  executionMethod: "executeCommand",  // or "ssh", "sessionCommand", "pty"
  env: { ANTHROPIC_API_KEY: key },
})
await session.start(prompt)
const { events } = await session.poll()
```

---

## Implementation Priority

### P0 (Critical - Week 1)
1. ProcessManager with proper state detection
2. Robust kill implementation
3. ExecuteCommandExecutor (simplest, most reliable)

### P1 (High - Week 2)
4. SessionCommandExecutor with PTY simulation
5. Environment handling simplification
6. Provider interface cleanup

### P2 (Medium - Week 3)
7. BackgroundSession redesign
8. State persistence
9. API simplification

### P3 (Low - Week 4)
10. Matrix testing for all provider × method combinations
11. Documentation updates
12. Migration tooling

---

## Files to Create/Modify

### New Files
- `src/execution/adapter.ts` - ExecutionAdapter interface
- `src/execution/process-manager.ts` - ProcessManager class
- `src/execution/methods/execute-command.ts` - ExecuteCommandExecutor
- `src/execution/methods/session-command.ts` - SessionCommandExecutor
- `src/execution/methods/ssh.ts` - SshExecutor (refactored)
- `src/execution/methods/pty.ts` - PtyExecutor (refactored)
- `src/session/state.ts` - SessionStore
- `src/session/background.ts` - Simplified BackgroundSession

### Modified Files
- `src/providers/base.ts` - Remove execution logic, keep command/parse
- `src/sandbox/daytona.ts` - Simplify, delegate to execution adapters
- `src/session.ts` - Use new execution engine
- `src/types/index.ts` - New types
- `src/index.ts` - New top-level API

### Deleted Files (after migration)
- Complex execution logic in `providers/base.ts` (700+ lines → ~200 lines)

---

## Success Metrics

1. **All 4 execution methods work** for all providers with real LLM output
2. **Process kill works reliably** (no zombies left running)
3. **Proper state detection** distinguishes running/zombie/dead
4. **Simpler codebase** - Provider base class from 784 lines to ~200 lines
5. **Better test coverage** - Matrix tests for all combinations
6. **Clearer API** - Single env option, explicit execution method selection

---

## Appendix: Key Learnings from Tests

### PTY Simulation Required
```bash
# CLI tools buffer output without TTY. Use script -q -c:
script -q -c "claude --print ..." output.jsonl
```

### Proper Process State Check
```bash
# kill -0 returns true for zombies. Use ps -o state:
STATE=$(ps -p $PID -o state= 2>/dev/null || echo "X")
# R=running, S=sleeping, Z=zombie, X=dead
```

### Robust Kill Sequence
```bash
kill -TERM $PID           # Graceful
kill -TERM -$PID          # Process group
kill -9 $PID              # Force
kill -9 -$PID             # Force process group
pkill -9 -f "process"     # By name
```

### executeCommand with nohup Works
```bash
# No need for SSH complexity:
nohup sh -c 'cmd >> out 2>&1; echo 1 > out.done' &
echo $!
```
