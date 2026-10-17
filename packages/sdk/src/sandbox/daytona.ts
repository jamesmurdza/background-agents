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
import { CODEX_RUNTIME_PREFIX, codexRuntimeInstallCommand, isSupportedCodexVersion } from "../utils/codex-runtime"

// Path to ELIZA bundle (uploaded to sandbox when needed)
const ELIZA_SANDBOX_PATH = "/tmp/eliza-cli.bundle.js"

export function adaptDaytonaSandbox(
  sandbox: Sandbox,
  options: AdaptSandboxOptions = {}
): CodeAgentSandbox {
  // Two-level environment: session (persistent) + run (cleared between runs)
  const sessionEnv: Record<string, string> = { ...options.env }
  const runEnv: Record<string, string> = {}
  let codexPath: string | undefined
  const getEnv = (jobEnv: Record<string, string> = {}): Record<string, string> => {
    const env = { ...sessionEnv, ...runEnv, ...jobEnv }
    if (codexPath) env.PATH = `${CODEX_RUNTIME_PREFIX}/bin:${env.PATH ?? codexPath}`
    return env
  }

  /** Execute a command synchronously */
  async function executeCommandInContext(command: string, timeout: number, context: { cwd?: string; env?: Record<string, string> } = {}): Promise<{ exitCode: number; output: string }> {
    const env = getEnv(context.env)
    const envExports = Object.entries(env)
      .map(([k, v]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new Error("Invalid sandbox environment name")
        return `export ${k}='${escapeShell(v)}'`
      })
      .join("; ")
    const fullCommand = envExports ? `${envExports}; ${command}` : command
    const result = await sandbox.process.executeCommand(fullCommand, context.cwd, undefined, timeout)
    return { exitCode: result.exitCode ?? -1, output: result.result ?? "" }
  }

  const executeCommand = (command: string, timeout = 60) => executeCommandInContext(command, timeout)

  // Long-running-process runner, wired to @background-agents/sandbox-jobs.
  // We wrap start() so the adapter's two-level env (session + run) is injected
  // into every job, exactly as the old executeBackground did — the package
  // itself stays env-agnostic.
  const baseJobs = createSandboxJobs(sandbox)
  const jobs: SandboxJobs = {
    ...baseJobs,
    start(opts: StartJobOptions) {
      return baseJobs.start({ ...opts, env: getEnv(opts.env) })
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
    getEffectiveEnv: getEnv,

    executeCommand,
    executeCommandInContext,
    async readProviderVersion(name, timeout, context) {
      if (name !== "codex") return undefined
      // A fresh adapter has not run ensureProvider(), so its PATH can still
      // point at an old global CLI. Inspect the exact launch runtime directly;
      // never install it or mutate codexPath/session/run env during discovery.
      const result = await executeCommandInContext(`${CODEX_RUNTIME_PREFIX}/bin/codex --version`, timeout, context)
      if (result.exitCode === 0 && !isSupportedCodexVersion(result.output)) {
        return { exitCode: 1, output: "" }
      }
      return result
    },
    jobs,

    async ensureProvider(name: ProviderName): Promise<void> {
      if (name === "codex") {
        // Always select the immutable, versioned runtime. A global CLI or a
        // custom PATH may point to a different (including newer) release.
        // Images preinstall this same directory, so preparing one is offline.
        const preparationError = "Codex CLI update failed. No agent was started. Retry, or ask the administrator to check the sandbox runtime installation."
        const prepared = await sandbox.process.executeCommand(codexRuntimeInstallCommand(), undefined, undefined, 240)
          .catch(() => { throw new Error(preparationError) })
        if (prepared.exitCode !== 0) {
          // Installer output may contain registry credentials. Keep it out of UI/logs.
          throw new Error(preparationError)
        }
        const verified = await sandbox.process.executeCommand(`${CODEX_RUNTIME_PREFIX}/bin/codex --version`, undefined, undefined, 15)
        if (verified.exitCode !== 0 || !isSupportedCodexVersion(verified.result ?? "")) {
          throw new Error("Codex CLI update could not be verified. No agent was started. Ask the administrator to check the sandbox runtime installation.")
        }
        const path = await sandbox.process.executeCommand("printf '%s' \"$PATH\"", undefined, undefined, 10)
        if (path.exitCode !== 0 || !path.result?.trim() || /[\r\n]/.test(path.result)) {
          throw new Error("Codex CLI runtime path could not be prepared. No agent was started.")
        }
        codexPath = path.result
        return
      }
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

      // goose, droid and kimi install outside the default PATH; check their known
      // binary locations too (goose/droid: ~/.local/bin, kimi: ~/.kimi-code/bin).
      const checkCommand =
        name === "goose" || name === "droid"
          ? `which ${name} || test -x "$HOME/.local/bin/${name}"`
          : name === "kimi"
            ? `which ${name} || test -x "$HOME/.kimi-code/bin/${name}"`
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

      // The sandbox runs as the non-root daytona user, which can't write to the
      // global npm prefix (/usr/local/lib/node_modules); it has passwordless sudo.
      const installCommand = shellInstaller ?? `sudo -n npm install -g ${packageName}`

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

      // Droid installs to ~/.local/bin; ensure it's on PATH for later runs.
      if (name === "droid") {
        await sandbox.process.executeCommand(
          `grep -q 'HOME/.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc`,
          undefined, undefined, 10
        )
      }

      // Kimi installs to ~/.kimi-code/bin; ensure it's on PATH for later runs.
      if (name === "kimi") {
        await sandbox.process.executeCommand(
          `grep -q 'HOME/.kimi-code/bin' ~/.bashrc || echo 'export PATH="$HOME/.kimi-code/bin:$PATH"' >> ~/.bashrc`,
          undefined, undefined, 10
        )
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
