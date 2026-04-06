/**
 * Daytona sandbox adapter: wraps a Sandbox from @daytonaio/sdk into CodeAgentSandbox.
 * Background-only execution using executeCommand + nohup.
 */
import type { Sandbox } from "@daytonaio/sdk"
import type { CodeAgentSandbox, AdaptSandboxOptions, ExecuteBackgroundOptions, ProviderName } from "../types/index.js"
import { getPackageName, getShellInstaller } from "../utils/install.js"

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
  const getEnv = (): Record<string, string> => ({ ...sessionEnv, ...runEnv })

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
    const safeDone = escapeShell(opts.outputFile + ".done")

    // nohup wrapper: run command, redirect output, create .done file when complete
    const wrapper = `nohup sh -c '${safeCmd} >> ${safeOutput} 2>&1; echo 1 > ${safeDone}' > /dev/null 2>&1 & echo $!`

    const result = await sandbox.process.executeCommand(wrapper, undefined, undefined, 30)
    const pid = Number((result.result ?? "").trim().split(/\s+/).pop() ?? "")

    if (!Number.isInteger(pid) || pid < 1) {
      throw new Error(`executeBackground: could not parse pid from: ${result.result?.slice(0, 200)}`)
    }
    return { pid }
  }

  /**
   * Kill a background process. Simple approach: SIGTERM, wait, SIGKILL.
   */
  async function killBackgroundProcess(pid: number, processName?: string): Promise<void> {
    await sandbox.process.executeCommand(`kill -TERM ${pid} 2>/dev/null || true`)
    await new Promise(r => setTimeout(r, 500))
    await sandbox.process.executeCommand(`kill -9 ${pid} 2>/dev/null || true; kill -9 -${pid} 2>/dev/null || true`)
    if (processName) {
      await sandbox.process.executeCommand(`pkill -9 -f "${escapeShell(processName)}" 2>/dev/null || true`)
    }
  }

  return {
    // Environment management
    setEnvVars(vars: Record<string, string>): void {
      Object.assign(sessionEnv, vars)
    },
    setSessionEnvVars(vars: Record<string, string>): void {
      Object.assign(sessionEnv, vars)
    },
    setRunEnvVars(vars: Record<string, string>): void {
      Object.assign(runEnv, vars)
    },
    clearRunEnvVars(): void {
      for (const key of Object.keys(runEnv)) delete runEnv[key]
    },

    executeCommand,
    executeBackground,
    killBackgroundProcess,

    /**
     * Optimized poll: reads meta.json, output file, and done status in 2 commands.
     */
    async pollBackgroundState(sessionDir: string): Promise<{
      meta: string | null
      output: string
      done: boolean
    } | null> {
      const metaPath = `${sessionDir}/meta.json`
      const metaResult = await sandbox.process.executeCommand(
        `cat '${escapeShell(metaPath)}' 2>/dev/null || echo '{}'`, undefined, undefined, 10
      )
      const metaRaw = (metaResult.result ?? "").trim()
      if (!metaRaw || metaRaw === "{}") return null

      let outputFile: string | undefined
      let pid: number | undefined
      try {
        const parsed = JSON.parse(metaRaw)
        outputFile = parsed.outputFile
        pid = parsed.pid
      } catch {
        return null
      }
      if (!outputFile) return { meta: metaRaw, output: "", done: false }

      // Read output file, check done status, and check process state in one command.
      // We check if the process is alive AND not a zombie (state != 'Z').
      // If the process was killed externally, it becomes a zombie, and we should
      // treat it as done to trigger crash detection.
      const safeOutput = escapeShell(outputFile)
      const safeDone = escapeShell(outputFile + ".done")
      // Check done file and process state
      const checkPidCmd = pid
        ? `STATE=$(ps -p ${pid} -o state= 2>/dev/null); if [ -n "$STATE" ] && [ "$STATE" != "Z" ]; then echo "ALIVE:yes"; else echo "ALIVE:no"; fi`
        : 'echo "ALIVE:no"'
      const result = await sandbox.process.executeCommand(
        `test -f '${safeDone}' && echo "DONE:yes" || echo "DONE:no"; ${checkPidCmd}; cat '${safeOutput}' 2>/dev/null || true`,
        undefined, undefined, 30
      )
      const raw = result.result ?? ""
      const lines = raw.split("\n")
      const doneLine = lines[0]?.trim() ?? ""
      const aliveLine = lines[1]?.trim() ?? ""
      const output = lines.slice(2).join("\n")

      // Process is done if:
      // 1. The .done file exists (normal completion), OR
      // 2. The process is no longer alive or is a zombie (crashed/killed)
      const doneFileExists = doneLine === "DONE:yes"
      const processAlive = aliveLine === "ALIVE:yes"
      const isDone = doneFileExists || (pid !== undefined && !processAlive)

      return { meta: metaRaw, output, done: isDone }
    },

    async ensureProvider(name: ProviderName): Promise<void> {
      // For goose, also check in ~/.local/bin which is the default install location
      const checkCommand = name === "goose"
        ? `which ${name} || test -x "$HOME/.local/bin/${name}"`
        : `which ${name}`
      const checkResult = await sandbox.process.executeCommand(checkCommand)
      if (checkResult.exitCode === 0) return

      console.log(`Installing ${name} CLI in sandbox...`)

      // Check if provider uses shell installer or npm
      const shellInstaller = getShellInstaller(name)
      const installCommand = shellInstaller ?? `npm install -g ${getPackageName(name)}`

      const installResult = await sandbox.process.executeCommand(
        installCommand, undefined, undefined, 120
      )
      if (installResult.exitCode !== 0) {
        const output = installResult.result ?? ""
        throw new Error(`Failed to install ${name} CLI in sandbox: ${output.slice(0, 500)}`)
      }
      console.log(`Installed ${name} CLI`)

      if (name === "gemini") {
        await sandbox.process.executeCommand("mkdir -p ~/.gemini", undefined, undefined, 30)
      }

      // For goose, add ~/.local/bin to PATH and create default config
      if (name === "goose") {
        await sandbox.process.executeCommand(
          `grep -q 'HOME/.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc`,
          undefined, undefined, 10
        )
        // Create default goose config if it doesn't exist
        // Uses OpenAI provider by default with gpt-4o model
        await sandbox.process.executeCommand(
          `mkdir -p ~/.config/goose && test -f ~/.config/goose/config.yaml || cat > ~/.config/goose/config.yaml << 'GOOSECONFIG'
GOOSE_PROVIDER: openai
GOOSE_MODEL: gpt-4o
GOOSE_MODE: auto
extensions:
  developer:
    enabled: true
    name: developer
    type: builtin
GOOSECONFIG`,
          undefined, undefined, 10
        )
      }
    },
  }
}
