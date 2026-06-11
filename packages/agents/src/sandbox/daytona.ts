/**
 * Daytona sandbox adapter: wraps a Sandbox from @daytonaio/sdk into CodeAgentSandbox.
 * Long-running processes are delegated to @background-agents/sandbox-jobs.
 */
import type { Sandbox } from "@daytonaio/sdk"
import { createSandboxJobs, type SandboxJobs, type StartJobOptions } from "@background-agents/sandbox-jobs"
import type { CodeAgentSandbox, AdaptSandboxOptions, ProviderName } from "../types/index"
import { getPackageName, getShellInstaller } from "../utils/install"
import { escapeShell } from "../utils/shell"
import { ELIZA_BUNDLE_B64 } from "../agents/eliza/bundle-content"

// Path to ELIZA bundle (uploaded to sandbox when needed)
const ELIZA_SANDBOX_PATH = "/tmp/eliza-cli.bundle.js"

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

  // Long-running-process runner, wired to @background-agents/sandbox-jobs.
  // We wrap start() so the adapter's two-level env (session + run) is injected
  // into every job, exactly as the old executeBackground did — the package
  // itself stays env-agnostic.
  const baseJobs = createSandboxJobs(sandbox)
  const jobs: SandboxJobs = {
    ...baseJobs,
    start(opts: StartJobOptions) {
      return baseJobs.start({ ...opts, env: { ...getEnv(), ...opts.env } })
    },
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
    jobs,

    async ensureProvider(name: ProviderName): Promise<void> {
      // ELIZA is built-in - upload the bundle to the sandbox
      if (name === "eliza") {
        // Check if already uploaded
        const checkResult = await sandbox.process.executeCommand(`test -f ${ELIZA_SANDBOX_PATH} && echo "exists"`)
        if (checkResult.result?.trim() === "exists") {
          return
        }

        // Upload the embedded bundle content to sandbox
        console.log(`Uploading ELIZA CLI bundle to sandbox...`)
        const bundleBuffer = Buffer.from(ELIZA_BUNDLE_B64, "base64")
        await sandbox.fs.uploadFile(bundleBuffer, ELIZA_SANDBOX_PATH)
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
