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
  copilot: "@github/copilot",
  kilo: "@kilocode/cli",
  kimi: "", // kimi uses a shell script installer, not npm
  opencode: "opencode-ai",
  gemini: "@google/gemini-cli",
  pi: "@mariozechner/pi-coding-agent",
} as const

/**
 * tokscale CLI version, pinned for reproducible snapshots and a stable
 * `tokscale models --json` output shape. Used for post-turn token/cost
 * metering — it reads each agent's native session files in the sandbox and
 * reports token counts + cost per session/model (pricing bundled in the
 * binary, so the web app owns no pricing code).
 *
 * The npm `tokscale` package is a thin alias for `@tokscale/cli`, whose binary
 * ships via platform optionalDependencies (`@tokscale/cli-linux-x64-gnu` on
 * this glibc/x64 image). A plain `npm install -g` therefore fully embeds the
 * binary at build time — no runtime download.
 */
export const TOKSCALE_VERSION = "3.1.2"

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
 * Also pre-installs tokscale (token/cost metering CLI; see TOKSCALE_VERSION).
 *
 * Note: Eliza is built-in to the agents package (no CLI installation needed).
 */
export function getAgentSandboxImage(): Image {
  return (
    Image.base("node:22-bookworm")
      .runCommands(
        // Install system dependencies (curl for Goose download, git for agents, sudo for user)
        "apt-get update && apt-get install -y --no-install-recommends " +
          "curl ca-certificates git bzip2 sudo " +
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
        // Install GitHub Copilot CLI
        "npm install -g @github/copilot"
      )
      .runCommands(
        // Install Kilo CLI
        "npm install -g @kilocode/cli"
      )
      .runCommands(
        // Install Kimi Code CLI (Moonshot). Shell-script installer, not npm —
        // run with HOME pointed at the daytona user so the `kimi` binary lands
        // in /home/daytona/.kimi-code/bin, then hand ownership to the daytona
        // user. KIMI_NO_MODIFY_PATH avoids the installer editing .profile; the
        // dir is added to PATH via .bashrc below.
        "export HOME=/home/daytona KIMI_NO_MODIFY_PATH=1 && " +
          "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash && " +
          "chown -R daytona:daytona /home/daytona/.kimi-code"
      )
      .runCommands(
        // Install tokscale (token/cost metering). Binary embeds at build time
        // via @tokscale/cli's platform optionalDependency — no runtime download.
        `npm install -g tokscale@${TOKSCALE_VERSION}`
      )
      // Create daytona user (non-root) - Claude Code refuses to run as root
      .runCommands(
        "useradd -m -s /bin/bash daytona || true && " +
          "echo 'daytona ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers"
      )
      // Install Goose binary
      .runCommands(
        "mkdir -p /home/daytona/.local/bin /tmp/goose_tmp && " +
          'curl -fsSL "https://github.com/block/goose/releases/download/stable/goose-x86_64-unknown-linux-gnu.tar.bz2" | ' +
          "tar -xjf - --no-same-owner --no-same-permissions -C /tmp/goose_tmp && " +
          "mv /tmp/goose_tmp/goose /home/daytona/.local/bin/goose && " +
          "chmod +x /home/daytona/.local/bin/goose && " +
          "rm -rf /tmp/goose_tmp"
      )
      // Create required directories and set up PATH for daytona user
      .runCommands(
        "mkdir -p /home/daytona/.gemini /home/daytona/.config/goose /home/daytona/project && " +
          "chown -R daytona:daytona /home/daytona"
      )
      // Pre-install ws + node-pty for @background-agents/daytona-terminal so
      // setupTerminal() finds them already present at /opt/pty-server and
      // skips its runtime install step. Path and versions must match what
      // daytona-terminal/src/sandbox/setup.ts and
      // daytona-terminal/src/server/pty-server.ts expect.
      .runCommands(
        "mkdir -p /opt/pty-server && " +
          "cd /opt/pty-server && " +
          "npm install --prefix /opt/pty-server ws@^8.18.0 node-pty@^1.0.0 && " +
          "chown -R daytona:daytona /opt/pty-server"
      )
      .runCommands(
        'echo \'export PATH="$HOME/.local/bin:$HOME/.kimi-code/bin:$PATH"\' >> /home/daytona/.bashrc'
      )
      // Set the default user to daytona
      .dockerfileCommands(["USER daytona"])
      .workdir("/home/daytona/project")
  )
}
