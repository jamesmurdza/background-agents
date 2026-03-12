import { execSync, spawnSync } from "node:child_process"
import type { ProviderName } from "../types/index.js"

/**
 * CLI package information for each provider
 */
const PROVIDER_PACKAGES: Record<ProviderName, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode",
  gemini: "@anthropic-ai/gemini-cli", // Placeholder - update when official package is available
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
 * Get the npm package name for a provider
 */
export function getPackageName(name: ProviderName): string {
  return PROVIDER_PACKAGES[name]
}

/**
 * Install a provider CLI globally via npm
 * @returns true if installation succeeded
 */
export function installProvider(name: ProviderName): boolean {
  const packageName = PROVIDER_PACKAGES[name]

  try {
    execSync(`npm install -g ${packageName}`, {
      stdio: "inherit",
      encoding: "utf8",
    })
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
    const packageName = PROVIDER_PACKAGES[name]
    throw new Error(
      `CLI '${name}' is not installed. ` +
        `Install it with: npm install -g ${packageName}`
    )
  }

  console.log(`Installing ${name} CLI...`)
  const success = installProvider(name)

  if (!success) {
    const packageName = PROVIDER_PACKAGES[name]
    throw new Error(
      `Failed to install '${name}' CLI. ` +
        `Try manually: npm install -g ${packageName}`
    )
  }

  console.log(`Successfully installed ${name} CLI`)
  return true
}

/**
 * Check installation status of all providers
 */
export function getInstallationStatus(): Record<ProviderName, boolean> {
  const providers: ProviderName[] = ["claude", "codex", "opencode", "gemini"]
  const status: Record<string, boolean> = {}

  for (const provider of providers) {
    status[provider] = isCliInstalled(provider)
  }

  return status as Record<ProviderName, boolean>
}
