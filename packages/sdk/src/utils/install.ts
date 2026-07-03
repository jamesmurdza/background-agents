import type { ProviderName } from "../types/index"

/**
 * CLI package information for each provider.
 * Note: goose uses a shell script installer, not npm.
 */
const PROVIDER_PACKAGES: Record<ProviderName, string> = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  copilot: "@github/copilot",
  droid: "", // droid uses a shell script installer, not npm
  eliza: "", // eliza is built-in, no installation needed
  goose: "", // goose uses shell script installer, not npm
  kilo: "@kilocode/cli",
  kimi: "", // kimi uses a shell script installer, not npm
  opencode: "opencode",
  gemini: "@google/gemini-cli",
  pi: "@mariozechner/pi-coding-agent",
}

/**
 * Shell script installers for providers that don't use npm.
 * These commands download and install the CLI binary directly.
 */
const PROVIDER_SHELL_INSTALLERS: Partial<Record<ProviderName, string>> = {
  // Goose: Download the binary directly without the interactive installer script
  // 1. Create temp and bin directories
  // 2. Download the tarball for x86_64 Linux
  // 3. Extract to temp dir and move binary to ~/.local/bin
  // Use --no-same-owner and --no-same-permissions to avoid permission issues
  goose: `mkdir -p ~/.local/bin ~/.goose_tmp && curl -fsSL "https://github.com/block/goose/releases/download/stable/goose-x86_64-unknown-linux-gnu.tar.bz2" | tar -xjf - --no-same-owner --no-same-permissions -C ~/.goose_tmp && mv ~/.goose_tmp/goose ~/.local/bin/goose && chmod +x ~/.local/bin/goose && rm -rf ~/.goose_tmp`,
  // Kimi Code: official install script. Drops the `kimi` binary into the user's
  // local bin (PATH must include ~/.local/bin). Runs non-interactively.
  kimi: `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`,
  // Factory Droid: official install script. Drops the `droid` binary into
  // ~/.local/bin (PATH must include it). Runs non-interactively.
  droid: `curl -fsSL https://app.factory.ai/cli | sh`,
}

/**
 * Get the npm package name for a provider.
 * Returns empty string for providers that don't use npm.
 */
export function getPackageName(name: ProviderName): string {
  return PROVIDER_PACKAGES[name]
}

/**
 * Get the shell installer command for a provider.
 * Returns undefined for providers that use npm.
 */
export function getShellInstaller(name: ProviderName): string | undefined {
  return PROVIDER_SHELL_INSTALLERS[name]
}
