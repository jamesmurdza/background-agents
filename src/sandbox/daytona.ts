/**
 * Daytona sandbox adapter: wraps a Sandbox from @daytonaio/sdk into CodeAgentSandbox.
 * Background session start always uses SSH (executeBackground) so start() returns quickly;
 * requires sandbox.createSshAccess(). All other commands use process API.
 * ssh2 is loaded dynamically to avoid bundlers (e.g. Next.js) pulling in native .node addons.
 */
import type { Client, ClientChannel } from "ssh2"
import type { Sandbox } from "@daytonaio/sdk"
import type { CodeAgentSandbox, AdaptSandboxOptions, ExecuteBackgroundOptions, ProviderName } from "../types/index.js"
import { getPackageName } from "../utils/install.js"

const SSH_HOST = "ssh.app.daytona.io"
const SSH_PORT = 22
const SSH_TOKEN_EXPIRY_MINUTES = 60

type SandboxWithSsh = Sandbox & { createSshAccess?(expiresInMinutes?: number): Promise<{ token: string }> }

function hasSshAccess(s: Sandbox): s is SandboxWithSsh {
  return typeof (s as SandboxWithSsh).createSshAccess === "function"
}

function execOverSsh(
  conn: Client,
  command: string,
  timeoutMs: number
): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const timer = timeoutMs > 0 ? setTimeout(() => reject(new Error(`SSH exec timeout after ${timeoutMs}ms`)), timeoutMs) : undefined
    conn.exec(command, (err: Error | undefined, stream: ClientChannel) => {
      if (err) {
        clearTimeout(timer as NodeJS.Timeout)
        reject(err)
        return
      }
      let stdout = ""
      let stderr = ""
      stream.on("data", (data: Buffer) => { stdout += data.toString() })
      stream.stderr.on("data", (data: Buffer) => { stderr += data.toString() })
      stream.on("close", (code: number) => {
        clearTimeout(timer as NodeJS.Timeout)
        resolve({ exitCode: code ?? 1, output: stdout + (stderr ? "\nSTDERR:\n" + stderr : "") })
      })
    })
  })
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b\[[\?]?[0-9;]*[hlm]|\r/g, "")
}

function isJsonLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("{") && trimmed.endsWith("}")
}

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

  let sshConnectPromise: Promise<Client> | null = null
  async function executeBackground(opts: ExecuteBackgroundOptions): Promise<{ pid: number }> {
    const t0 = Date.now()
    if (!hasSshAccess(sandbox)) throw new Error("Sandbox has no createSshAccess(); cannot run background command over SSH.")
    let t = Date.now()
    if (!sshConnectPromise) {
      sshConnectPromise = (async () => {
        const { Client: SshClient } = await import("ssh2")
        return new Promise<Client>((resolve, reject) => {
          sandbox.createSshAccess!(SSH_TOKEN_EXPIRY_MINUTES).then((access) => {
            const c = new SshClient()
            c.on("ready", () => resolve(c))
            c.on("error", reject)
            c.connect({ host: SSH_HOST, port: SSH_PORT, username: access.token })
          }).catch(reject)
        })
      })()
    }
    const conn = await sshConnectPromise
    console.log(`[timing] SSH connect (or reuse) took ${Date.now() - t}ms`)

    if (process.env.CODING_AGENTS_SSH_TIMING_TESTS === "1") {
      const testCases: { name: string; command: string }[] = [
        { name: "echo only", command: "echo 123" },
        { name: "sleep 1 then echo", command: "sleep 1 && echo 123" },
        { name: "sleep 3 then echo", command: "sleep 3 && echo 123" },
        { name: "background sleep 5, echo $! and cat pid", command: "( sleep 5 & echo $! > /tmp/p.pid ; cat /tmp/p.pid )" },
        { name: "wrapper shape ( ( sleep 10 ... ) & echo $! ; cat pid )", command: "( ( sleep 10 >> /tmp/out 2>&1 ; echo 1 > /tmp/out.done ) & echo $! > /tmp/w.pid ; cat /tmp/w.pid )" },
      ]
      console.log("[timing] --- SSH wrapper timing tests ---")
      for (const { name, command } of testCases) {
        const tTest = Date.now()
        const res = await execOverSsh(conn, command, 15_000)
        console.log(`[timing]   ${(Date.now() - tTest) / 1000}s  ${name}  exit=${res.exitCode} out=${(res.output ?? "").trim().slice(0, 40)}`)
      }
      console.log("[timing] --- end timing tests ---")
    }

    const envPrefix = Object.entries(envVars)
      .map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`)
      .join(" ")
    const cmd = envPrefix ? `${envPrefix} ${opts.command}` : opts.command
    // nohup detaches from SSH session so channel closes and we get PID immediately (like Daytona example)
    // Write outputFile.done when command exits so isRunning can use it (process API may not see SSH-started pid)
    const safeCmd = cmd.replace(/'/g, "'\\''")
    const safeOutput = opts.outputFile.replace(/'/g, "'\\''")
    const doneFile = opts.outputFile + ".done"
    const safeDone = doneFile.replace(/'/g, "'\\''")
    const wrapper = `nohup sh -c '${safeCmd} >> ${safeOutput} 2>&1; echo 1 > ${safeDone}' > /dev/null 2>&1 & echo $!`
    t = Date.now()
    const result = await execOverSsh(conn, wrapper, 15_000)
    console.log(`[timing] execOverSsh(wrapper) took ${Date.now() - t}ms (executeBackground total ${Date.now() - t0}ms)`)
    const raw = (result.output ?? "").trim().split(/\s+/).pop() ?? ""
    const pid = Number(raw)
    if (!Number.isInteger(pid) || pid < 1) throw new Error(`executeBackground: could not parse pid: ${result.output?.slice(0, 200)}`)
    return { pid }
  }

  async function killBackgroundProcess(pid: number): Promise<void> {
    if (!hasSshAccess(sandbox)) throw new Error("Sandbox has no createSshAccess(); cannot kill over SSH.")
    if (!sshConnectPromise) return
    const conn = await sshConnectPromise
    await execOverSsh(conn, `kill ${pid} 2>/dev/null || kill -9 ${pid} 2>/dev/null || true`, 10_000)
  }

  const result: CodeAgentSandbox = {
    setEnvVars(vars: Record<string, string>): void {
      Object.assign(envVars, vars)
    },

    executeCommand,
    killBackgroundProcess,

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
            if (cleaned) {
              // Log all non-empty lines for debugging
              if (process.env.CODING_AGENTS_DEBUG) {
                console.error(`[sandbox-stream] ${cleaned.substring(0, 200)}`)
              }
              if (isJsonLine(cleaned)) {
                if (resolveNext) {
                  resolveNext({ value: cleaned, done: false })
                  resolveNext = null
                } else {
                  lineQueue.push(cleaned)
                }
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
  // Background commands always use SSH so start() returns quickly.
  result.executeBackground = executeBackground
  return result
}
