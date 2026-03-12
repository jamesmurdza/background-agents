import type { Sandbox } from "@daytonaio/sdk"
import type { CodeAgentSandbox, AdaptSandboxOptions, ProviderName } from "../types/index.js"
import { getPackageName } from "../utils/install.js"

export type { CodeAgentSandbox, AdaptSandboxOptions } from "../types/index.js"

/**
 * Strip ANSI escape codes and terminal control sequences from text
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]|\r/g, "")
}

function isJsonLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("{") && trimmed.endsWith("}")
}

/**
 * Wraps a Daytona Sandbox so it can be used with createProvider/createSession.
 * Create the sandbox yourself with @daytonaio/sdk, then pass it here.
 */
export function adaptDaytonaSandbox(
  sandbox: Sandbox,
  options: AdaptSandboxOptions = {}
): CodeAgentSandbox {
  const envVars: Record<string, string> = { ...options.env }

  async function isProviderInstalled(name: ProviderName): Promise<boolean> {
    try {
      const result = await sandbox.process.executeCommand(`which ${name}`)
      return result.exitCode === 0
    } catch {
      return false
    }
  }

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

  async function executeCommand(command: string, timeout: number = 60): Promise<{ exitCode: number; output: string }> {
    const envPrefix = Object.entries(envVars)
      .map(([k, v]) => `${k}='${v.replace(/'/g, "'\\''")}'`)
      .join(" ")
    const fullCommand = envPrefix ? `${envPrefix} ${command}` : command
    const result = await sandbox.process.executeCommand(
      fullCommand,
      undefined,
      undefined,
      timeout
    )
    return { exitCode: result.exitCode ?? 0, output: result.result ?? "" }
  }

  return {
    setEnvVars(vars: Record<string, string>): void {
      Object.assign(envVars, vars)
    },

    executeCommand,

    async ensureProvider(name: ProviderName): Promise<void> {
      const installed = await isProviderInstalled(name)
      if (!installed) {
        console.log(`Installing ${name} CLI in sandbox...`)
        const success = await installProvider(name)
        if (!success) {
          throw new Error(`Failed to install ${name} CLI in sandbox`)
        }
        console.log(`Installed ${name} CLI`)
      }
    },

    async *executeCommandStream(
      command: string,
      _timeout: number = 120
    ): AsyncGenerator<string, void, unknown> {
      const envExports = Object.entries(envVars)
        .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
        .join("; ")
      const timedCommand = _timeout > 0 ? `timeout ${_timeout}s ${command}` : command
      const fullCommand = envExports ? `${envExports}; ${timedCommand}` : timedCommand

      let buffer = ""
      const lineQueue: string[] = []
      let resolveNext: ((value: IteratorResult<string, void>) => void) | null = null
      let ptyDone = false
      let ptyHandle: Awaited<ReturnType<Sandbox["process"]["createPty"]>> | null = null

      const ptyId = `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      ptyHandle = await sandbox.process.createPty({
        id: ptyId,
        onData: (data: Uint8Array) => {
          const text = new TextDecoder().decode(data)
          buffer += text
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""
          for (const line of lines) {
            const cleaned = stripAnsi(line).trim()
            if (cleaned && isJsonLine(cleaned)) {
              if (resolveNext) {
                resolveNext({ value: cleaned, done: false })
                resolveNext = null
              } else {
                lineQueue.push(cleaned)
              }
            }
          }
        },
      })

      try {
        await ptyHandle.waitForConnection()
        await ptyHandle.sendInput(`${fullCommand}\n`)
        await ptyHandle.sendInput("exit\n")

        const waitPromise = ptyHandle.wait().then(() => {
          ptyDone = true
          const cleaned = stripAnsi(buffer).trim()
          if (cleaned && isJsonLine(cleaned)) {
            if (resolveNext) {
              resolveNext({ value: cleaned, done: false })
              resolveNext = null
            } else {
              lineQueue.push(cleaned)
            }
          }
          if (resolveNext) {
            resolveNext({ value: undefined, done: true })
            resolveNext = null
          }
        })

        while (true) {
          if (lineQueue.length > 0) {
            yield lineQueue.shift()!
          } else if (ptyDone) {
            break
          } else {
            const result = await new Promise<IteratorResult<string, void>>((resolve) => {
              resolveNext = resolve
              if (lineQueue.length > 0) {
                resolve({ value: lineQueue.shift()!, done: false })
                resolveNext = null
              } else if (ptyDone) {
                resolve({ value: undefined, done: true })
                resolveNext = null
              }
            })
            if (result.done) break
            yield result.value
          }
        }

        await waitPromise
      } finally {
        if (ptyHandle) {
          await ptyHandle.disconnect()
        }
      }
    },
  }
}
