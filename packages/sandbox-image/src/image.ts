import { Image } from "@daytonaio/sdk"

/**
 * Snapshot name used for sandbox creation.
 * Must match what's registered with Daytona.
 */
export const SNAPSHOT_NAME = "background-agents"

/**
 * Resource limits for the snapshot.
 * - cpu: vCPUs
 * - memory: GB of RAM
 * - disk: GB of disk
 */
export const SNAPSHOT_RESOURCES = {
  cpu: 1,
  memory: 3, // 3GB RAM
  disk: 5, // 5GB disk
} as const

/**
 * NPM packages to pre-install for each agent CLI.
 * Goose uses a binary download, not npm.
 */
export const AGENT_PACKAGES = {
  claude: "@anthropic-ai/claude-code",
  codex: "@openai/codex",
  opencode: "opencode-ai",
  gemini: "@google/gemini-cli",
  pi: "@mariozechner/pi-coding-agent",
} as const

/**
 * Shell command to install Goose binary (not available via npm).
 */
const GOOSE_INSTALL_CMD = `
  mkdir -p ~/.local/bin ~/.goose_tmp &&
  curl -fsSL "https://github.com/block/goose/releases/download/stable/goose-x86_64-unknown-linux-gnu.tar.bz2" |
  tar -xjf - --no-same-owner --no-same-permissions -C ~/.goose_tmp &&
  mv ~/.goose_tmp/goose ~/.local/bin/goose &&
  chmod +x ~/.local/bin/goose &&
  rm -rf ~/.goose_tmp
`
  .trim()
  .replace(/\n\s*/g, " ")

/**
 * Builds the Daytona Image spec with all agent CLIs pre-installed.
 *
 * Pre-installed agents:
 * - Claude (@anthropic-ai/claude-code)
 * - Codex (@openai/codex)
 * - OpenCode (opencode-ai)
 * - Gemini (@google/gemini-cli)
 * - Pi (@mariozechner/pi-coding-agent)
 * - Goose (binary from GitHub releases)
 *
 * Note: Eliza is built-in to the agents package (no CLI installation needed).
 */
export function getAgentSandboxImage(): Image {
  const npmPackages = Object.values(AGENT_PACKAGES).join(" ")

  return Image.base("node:22-bookworm")
    .runCommands(
      // Install system dependencies (curl for Goose download, git for agents)
      "apt-get update && apt-get install -y --no-install-recommends " +
        "curl ca-certificates git bzip2 " +
        "&& rm -rf /var/lib/apt/lists/*"
    )
    .runCommands(
      // Install Claude Code CLI
      "npm install -g @anthropic-ai/claude-code"
    )
    .runCommands(
      // Install Codex CLI
      "npm install -g @openai/codex"
    )
    .runCommands(
      // Install Gemini CLI
      "npm install -g @google/gemini-cli"
    )
    .runCommands(
      // Install OpenCode CLI
      "npm install -g opencode-ai"
    )
    .runCommands(
      // Install Pi CLI
      "npm install -g @mariozechner/pi-coding-agent"
    )
    .runCommands(
      // Install Goose binary
      GOOSE_INSTALL_CMD
    )
    .runCommands(
      // Create required directories and add ~/.local/bin to PATH
      "mkdir -p ~/.gemini ~/.config/goose /home/daytona && " +
        'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> ~/.bashrc'
    )
    .workdir("/home/daytona")
}
