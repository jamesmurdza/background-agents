import { execSync, spawnSync } from "node:child_process"
import type { ProviderName } from "../types/index.js"

/**
 * CLI package information for each provider
 * Value is either an npm package name or a special install command prefixed with "!"
 */
const PROVIDER_PACKAGES: Record<ProviderName, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode",
  gemini: "@google/gemini-cli",
  // Picocode is installed via shell script, not npm
  picocode: "!curl -sSfL https://raw.githubusercontent.com/jondot/picocode/main/install.sh | sh",
}

/**
 * Check if a CLI command is available in PATH
 */
export function isCliInstalled(name: ProviderName): boolean {
  try {
    const result = spawnSync("which", [name], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
    return result.status === 0
  } catch {
    return false
  }
}

/**
 * Get the installation instructions for a provider
 * Returns npm package name for npm-installed providers,
 * or the shell command for custom-installed providers.
 */
export function getPackageName(name: ProviderName): string {
  const packageInfo = PROVIDER_PACKAGES[name]
  // For custom install commands, return the command without the "!" prefix
  return packageInfo.startsWith("!") ? packageInfo.slice(1) : packageInfo
}

/**
 * Install a provider CLI globally
 * Supports npm packages and custom install commands (prefixed with "!")
 * @returns true if installation succeeded
 */
export function installProvider(name: ProviderName): boolean {
  const packageInfo = PROVIDER_PACKAGES[name]

  try {
    // Check if this is a custom install command (starts with "!")
    if (packageInfo.startsWith("!")) {
      const installCommand = packageInfo.slice(1) // Remove the "!" prefix
      execSync(installCommand, {
        stdio: "inherit",
        encoding: "utf8",
        shell: "/bin/bash",
      })
    } else {
      // Standard npm install
      execSync(`npm install -g ${packageInfo}`, {
        stdio: "inherit",
        encoding: "utf8",
      })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Ensure a provider CLI is installed, installing it if necessary
 * @param name - Provider name
 * @param autoInstall - Whether to automatically install if missing (default: false)
 * @returns true if CLI is available (either already installed or successfully installed)
 * @throws Error if CLI is not installed and autoInstall is false
 */
export function ensureCliInstalled(
  name: ProviderName,
  autoInstall: boolean = false
): boolean {
  if (isCliInstalled(name)) {
    return true
  }

  if (!autoInstall) {
    const packageInfo = PROVIDER_PACKAGES[name]
    const installInstructions = packageInfo.startsWith("!")
      ? packageInfo.slice(1) // Show the shell command
      : `npm install -g ${packageInfo}`
    throw new Error(
      `CLI '${name}' is not installed. ` +
        `Install it with: ${installInstructions}`
    )
  }

  console.log(`Installing ${name} CLI...`)
  const success = installProvider(name)

  if (!success) {
    const packageInfo = PROVIDER_PACKAGES[name]
    const installInstructions = packageInfo.startsWith("!")
      ? packageInfo.slice(1)
      : `npm install -g ${packageInfo}`
    throw new Error(
      `Failed to install '${name}' CLI. ` +
        `Try manually: ${installInstructions}`
    )
  }

  console.log(`Successfully installed ${name} CLI`)
  return true
}

/**
 * Check installation status of all providers
 */
export function getInstallationStatus(): Record<ProviderName, boolean> {
  const providers: ProviderName[] = ["claude", "codex", "opencode", "gemini", "picocode"]
  const status: Record<string, boolean> = {}

  for (const provider of providers) {
    status[provider] = isCliInstalled(provider)
  }

  return status as Record<ProviderName, boolean>
}
