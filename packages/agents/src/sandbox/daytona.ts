/**
 * Daytona sandbox adapter: wraps a Sandbox from @daytonaio/sdk into CodeAgentSandbox.
 *
 * Background execution uses executeCommand + nohup.
 * Streaming uses executeSessionCommand + getSessionCommandLogs.
 */
import type { Sandbox } from "@daytonaio/sdk"
import type { CodeAgentSandbox, AdaptSandboxOptions, ExecuteBackgroundOptions, ProviderName } from "../types/index.js"
import { getPackageName } from "../utils/install.js"

/** Check if a line looks like JSON */
function isJsonLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("{") && trimmed.endsWith("}")
}

/** Escape a string for use in single-quoted shell strings */
function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''")
}

/** Build environment variable prefix for shell commands */
function buildEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}='${escapeShell(v)}'`)
    .join(" ")
}

export function adaptDaytonaSandbox(
  sandbox: Sandbox,
  options: AdaptSandboxOptions = {}
): CodeAgentSandbox {
  // Two-level environment: session (persistent) + run (cleared between runs)
  const sessionEnv: Record<string, string> = { ...options.env }
  const runEnv: Record<string, string> = {}

  // Compute merged env with run-level taking precedence
  const getEnv = (): Record<string, string> => ({ ...sessionEnv, ...runEnv })

  /** Check if provider CLI is installed */
  async function isProviderInstalled(name: ProviderName): Promise<boolean> {
    try {
      const result = await sandbox.process.executeCommand(`which ${name}`)
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /** Install provider CLI via npm */
  async function installProvider(name: ProviderName): Promise<boolean> {
    const packageName = getPackageName(name)
    try {
      const result = await sandbox.process.executeCommand(
        `npm install -g ${packageName}`,
        undefined,
        undefined,
        120
      )
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /** Execute a command synchronously */
  async function executeCommand(command: string, timeout: number = 60): Promise<{ exitCode: number; output: string }> {
    const envPrefix = buildEnvPrefix(getEnv())
    const fullCommand = envPrefix ? `${envPrefix} ${command}` : command
    const result = await sandbox.process.executeCommand(fullCommand, undefined, undefined, timeout)
    return { exitCode: result.exitCode ?? 0, output: result.result ?? "" }
  }

  /**
   * Execute a command in the background using nohup.
   * Returns immediately with PID. Output goes to outputFile.
   * Creates outputFile.done when command completes.
   */
  async function executeBackground(opts: ExecuteBackgroundOptions): Promise<{ pid: number }> {
    const envPrefix = buildEnvPrefix(getEnv())
    const cmd = envPrefix ? `${envPrefix} ${opts.command}` : opts.command
    const safeCmd = escapeShell(cmd)
    const safeOutput = escapeShell(opts.outputFile)
    const doneFile = opts.outputFile + ".done"
    const safeDone = escapeShell(doneFile)

    // nohup wrapper: run command, redirect output, create .done file when complete
    const wrapper = `nohup sh -c '${safeCmd} >> ${safeOutput} 2>&1; echo 1 > ${safeDone}' > /dev/null 2>&1 & echo $!`

    const result = await sandbox.process.executeCommand(wrapper, undefined, undefined, 30)
    const raw = (result.result ?? "").trim().split(/\s+/).pop() ?? ""
    const pid = Number(raw)

    if (!Number.isInteger(pid) || pid < 1) {
      throw new Error(`executeBackground: could not parse pid from: ${result.result?.slice(0, 200)}`)
    }

    return { pid }
  }

  /**
   * Check if a process is actually running (not zombie or dead).
   * Uses ps -o state instead of kill -0 (which lies about zombies).
   */
  async function isProcessRunning(pid: number): Promise<boolean> {
    const result = await sandbox.process.executeCommand(
      `ps -p ${pid} -o state= 2>/dev/null || echo X`
    )
    const state = result.result?.trim() || "X"
    // R=running, S=sleeping, D=disk sleep - these are "alive"
    // Z=zombie, X=dead, ""=not found - these are "dead"
    return state !== "Z" && state !== "X" && state !== ""
  }

  /**
   * Kill a background process robustly.
   * Tries SIGTERM, then SIGKILL, then pkill as last resort.
   */
  async function killBackgroundProcess(pid: number, processName?: string): Promise<void> {
    // Step 1: Graceful SIGTERM
    await sandbox.process.executeCommand(`kill -TERM ${pid} 2>/dev/null || true`)

    // Brief wait for graceful shutdown
    await new Promise(r => setTimeout(r, 500))

    // Step 2: Check if still running, force kill if needed
    if (await isProcessRunning(pid)) {
      await sandbox.process.executeCommand(`kill -9 ${pid} 2>/dev/null || true`)
      await new Promise(r => setTimeout(r, 300))
    }

    // Step 3: Also try process group kill
    await sandbox.process.executeCommand(`kill -9 -${pid} 2>/dev/null || true`)

    // Step 4: Last resort - pkill by name if provided
    if (processName) {
      await sandbox.process.executeCommand(`pkill -9 -f "${escapeShell(processName)}" 2>/dev/null || true`)
    }
  }

  return {
    // Environment management (two-level: session + run)
    setEnvVars(vars: Record<string, string>): void {
      // Backwards compat: map to session-level
      Object.assign(sessionEnv, vars)
    },

    setSessionEnvVars(vars: Record<string, string>): void {
      Object.assign(sessionEnv, vars)
    },

    setRunEnvVars(vars: Record<string, string>): void {
      Object.assign(runEnv, vars)
    },

    clearRunEnvVars(): void {
      // Clear run-level env between runs
      for (const key of Object.keys(runEnv)) {
        delete runEnv[key]
      }
    },

    executeCommand,
    executeBackground,
    killBackgroundProcess,
    isProcessRunning,

    /**
     * Optimized combined poll: reads meta.json, output file, and done status in ONE command.
     * This reduces 4 separate executeCommand calls to 1, dramatically improving poll latency.
     */
    async pollBackgroundState(sessionDir: string): Promise<{
      meta: string | null
      output: string
      done: boolean
    } | null> {
      // Combined shell command that outputs:
      // Line 1: META:<base64-encoded meta.json or empty>
      // Line 2: DONE:<yes|no>
      // Line 3+: raw output file content
      //
      // We use base64 for meta to avoid JSON parsing issues with embedded newlines
      const metaPath = `${sessionDir}/meta.json`

      // First get meta to find the output file
      const metaResult = await sandbox.process.executeCommand(
        `cat '${escapeShell(metaPath)}' 2>/dev/null || echo '{}'`,
        undefined,
        undefined,
        10
      )
      const metaRaw = (metaResult.result ?? "").trim()
      if (!metaRaw || metaRaw === "{}") {
        return null
      }

      // Parse meta to get output file path
      let outputFile: string | undefined
      try {
        const parsed = JSON.parse(metaRaw)
        outputFile = parsed.outputFile
      } catch {
        return null
      }

      if (!outputFile) {
        return { meta: metaRaw, output: "", done: false }
      }

      // Now read output file and check done status in one command
      const safeOutput = escapeShell(outputFile)
      const safeDone = escapeShell(outputFile + ".done")
      const combinedCmd = `test -f '${safeDone}' && echo "DONE:yes" || echo "DONE:no"; cat '${safeOutput}' 2>/dev/null || true`

      const result = await sandbox.process.executeCommand(combinedCmd, undefined, undefined, 30)
      const raw = result.result ?? ""

      // Parse the combined output
      const firstNewline = raw.indexOf("\n")
      const doneLine = firstNewline > 0 ? raw.slice(0, firstNewline) : raw
      const output = firstNewline > 0 ? raw.slice(firstNewline + 1) : ""
      const done = doneLine.trim() === "DONE:yes"

      return { meta: metaRaw, output, done }
    },

    async ensureProvider(name: ProviderName): Promise<void> {
      const installed = await isProviderInstalled(name)
      if (!installed) {
        console.log(`Installing ${name} CLI in sandbox...`)
        const success = await installProvider(name)
        if (!success) {
          throw new Error(`Failed to install ${name} CLI in sandbox`)
        }
        console.log(`Installed ${name} CLI`)

        // Post-install setup for Gemini
        if (name === "gemini") {
          await sandbox.process.executeCommand("mkdir -p ~/.gemini", undefined, undefined, 30)
        }
      }
    },

    /**
     * Stream command output using executeSessionCommand + getSessionCommandLogs.
     * Yields JSON lines as they arrive.
     */
    async *executeCommandStream(
      command: string,
      timeout: number = 120
    ): AsyncGenerator<string, void, unknown> {
      const envExports = Object.entries(getEnv())
        .map(([k, v]) => `export ${k}='${escapeShell(v)}'`)
        .join("; ")
      const timedCommand = timeout > 0 ? `timeout ${timeout}s ${command}` : command
      const fullCommand = envExports ? `${envExports}; ${timedCommand}` : timedCommand

      // Create session and start command async
      const sessionId = `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      await sandbox.process.createSession(sessionId)

      const { cmdId } = await sandbox.process.executeSessionCommand(sessionId, {
        command: fullCommand,
        runAsync: true,
      })

      // Stream logs via callbacks
      const lineQueue: string[] = []
      let resolveNext: ((value: IteratorResult<string, void>) => void) | null = null
      let streamDone = false
      let buffer = ""

      const processChunk = (chunk: string) => {
        buffer += chunk
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed && isJsonLine(trimmed)) {
            if (resolveNext) {
              resolveNext({ value: trimmed, done: false })
              resolveNext = null
            } else {
              lineQueue.push(trimmed)
            }
          }
        }
      }

      const logsPromise = sandbox.process.getSessionCommandLogs(
        sessionId,
        cmdId,
        (chunk) => processChunk(chunk), // onStdout
        (chunk) => processChunk(chunk)  // onStderr
      ).then(() => {
        // Process any remaining buffer
        const trimmed = buffer.trim()
        if (trimmed && isJsonLine(trimmed)) {
          if (resolveNext) {
            resolveNext({ value: trimmed, done: false })
            resolveNext = null
          } else {
            lineQueue.push(trimmed)
          }
        }
        streamDone = true
        if (resolveNext) {
          resolveNext({ value: undefined, done: true })
          resolveNext = null
        }
      })

      try {
        while (true) {
          if (lineQueue.length > 0) {
            yield lineQueue.shift()!
          } else if (streamDone) {
            break
          } else {
            const result = await new Promise<IteratorResult<string, void>>((resolve) => {
              resolveNext = resolve
              if (lineQueue.length > 0) {
                resolve({ value: lineQueue.shift()!, done: false })
                resolveNext = null
              } else if (streamDone) {
                resolve({ value: undefined, done: true })
                resolveNext = null
              }
            })
            if (result.done) break
            yield result.value
          }
        }
        await logsPromise
      } finally {
        await sandbox.process.deleteSession(sessionId).catch(() => {})
      }
    },
  }
}
