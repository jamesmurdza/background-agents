/**
 * Daytona sandbox adapter: wraps a Sandbox from @daytonaio/sdk into CodeAgentSandbox.
 * Background-only execution using executeCommand + nohup.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { Sandbox } from "@daytonaio/sdk"
import type { CodeAgentSandbox, AdaptSandboxOptions, ExecuteBackgroundOptions, ProviderName } from "../types/index"
import { getPackageName, getShellInstaller } from "../utils/install"

// Path to ELIZA bundle (uploaded to sandbox when needed)
const ELIZA_SANDBOX_PATH = "/tmp/eliza-cli.bundle.js"

/**
 * Get the path to the ELIZA CLI bundle.
 * Works from both dist/ (compiled) and src/ (development) contexts.
 */
function getElizaBundlePath(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  // When running from dist/, the bundle is at dist/agents/eliza/cli.bundle.js
  // __dirname = /path/to/packages/agents/dist/sandbox
  const distPath = path.join(__dirname, "..", "agents", "eliza", "cli.bundle.js")
  if (fs.existsSync(distPath)) {
    return distPath
  }

  // When running from src/, look in dist/
  const srcMatch = __dirname.match(/^(.*)\/src\/sandbox$/)
  if (srcMatch) {
    const fromSrcPath = path.join(srcMatch[1], "dist", "agents", "eliza", "cli.bundle.js")
    if (fs.existsSync(fromSrcPath)) {
      return fromSrcPath
    }
  }

  // Fallback
  return distPath
}

/** Escape a string for use in single-quoted shell strings */
function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''")
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
    const env = getEnv()
    const envExports = Object.entries(env)
      .map(([k, v]) => `export ${k}='${escapeShell(v)}'`)
      .join("; ")
    const fullCommand = envExports ? `${envExports}; ${command}` : command
    const result = await sandbox.process.executeCommand(fullCommand, undefined, undefined, timeout)
    return { exitCode: result.exitCode ?? 0, output: result.result ?? "" }
  }

  /**
   * Execute a command in the background using nohup.
   * Returns immediately with PID. Output goes to outputFile.
   * Creates outputFile.done when command completes.
   */
  async function executeBackground(opts: ExecuteBackgroundOptions): Promise<{ pid: number }> {
    const mergedEnv = getEnv()
    // Use export so env vars persist across && chains (e.g. "cd /path && gemini ...")
    const envExports = Object.entries(mergedEnv)
      .map(([k, v]) => `export ${k}='${escapeShell(v)}'`)
      .join("; ")
    const cmd = envExports ? `${envExports}; ${opts.command}` : opts.command
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
      try {
        outputFile = JSON.parse(metaRaw).outputFile
      } catch {
        return null
      }
      if (!outputFile) return { meta: metaRaw, output: "", done: false }

      // Read output file and check done status in one command
      const safeOutput = escapeShell(outputFile)
      const safeDone = escapeShell(outputFile + ".done")
      const result = await sandbox.process.executeCommand(
        `test -f '${safeDone}' && echo "DONE:yes" || echo "DONE:no"; cat '${safeOutput}' 2>/dev/null || true`,
        undefined, undefined, 30
      )
      const raw = result.result ?? ""
      const firstNewline = raw.indexOf("\n")
      const doneLine = firstNewline > 0 ? raw.slice(0, firstNewline) : raw
      const output = firstNewline > 0 ? raw.slice(firstNewline + 1) : ""

      return { meta: metaRaw, output, done: doneLine.trim() === "DONE:yes" }
    },

    async ensureProvider(name: ProviderName): Promise<void> {
      // ELIZA is built-in - upload the bundle to the sandbox
      if (name === "eliza") {
        // Check if already uploaded
        const checkResult = await sandbox.process.executeCommand(`test -f ${ELIZA_SANDBOX_PATH} && echo "exists"`)
        if (checkResult.result?.trim() === "exists") {
          return
        }

        // Read the bundle from local filesystem and upload to sandbox
        const bundlePath = getElizaBundlePath()
        if (!fs.existsSync(bundlePath)) {
          throw new Error(`ELIZA bundle not found at ${bundlePath}. Run 'npm run build' in packages/agents first.`)
        }

        console.log(`Uploading ELIZA CLI bundle to sandbox...`)
        const bundleContent = fs.readFileSync(bundlePath)
        await sandbox.fs.uploadFile(bundleContent, ELIZA_SANDBOX_PATH)
        console.log(`Uploaded ELIZA CLI bundle to ${ELIZA_SANDBOX_PATH}`)
        return
      }

      // For goose, also check in ~/.local/bin which is the default install location
      const checkCommand = name === "goose"
        ? `which ${name} || test -x "$HOME/.local/bin/${name}"`
        : `which ${name}`
      const checkResult = await sandbox.process.executeCommand(checkCommand)
      if (checkResult.exitCode === 0) return

      console.log(`Installing ${name} CLI in sandbox...`)

      // Check if provider uses shell installer or npm
      const shellInstaller = getShellInstaller(name)
      const packageName = getPackageName(name)

      // Skip installation if no package name and no shell installer (built-in provider)
      if (!shellInstaller && !packageName) {
        return
      }

      const installCommand = shellInstaller ?? `npm install -g ${packageName}`

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
