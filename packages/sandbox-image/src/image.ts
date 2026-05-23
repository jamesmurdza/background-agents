import { Image } from "@daytonaio/sdk"
import {
  PROVIDER_PACKAGES,
  PROVIDER_SHELL_INSTALLERS,
} from "background-agents"

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
 * Get the Goose install command, adapted for the sandbox image build.
 * Uses absolute paths since we're installing as root before the user exists.
 */
function getGooseInstallCmd(): string {
  const cmd = PROVIDER_SHELL_INSTALLERS.goose
  if (!cmd) return ""
  // Replace ~ with /home/daytona for absolute paths
  return cmd.replace(/~/g, "/home/daytona")
}

/**
 * Builds the Daytona Image spec with all agent CLIs pre-installed.
 *
 * Pre-installed agents are sourced from PROVIDER_PACKAGES in background-agents.
 * Goose uses a binary installer from PROVIDER_SHELL_INSTALLERS.
 * Eliza is built-in to the agents package (no CLI installation needed).
 */
export function getAgentSandboxImage(): Image {
  // Get npm packages (filter out empty strings for built-in/shell-installed providers)
  const npmPackages = Object.entries(PROVIDER_PACKAGES)
    .filter(([_, pkg]) => pkg !== "")
    .map(([_, pkg]) => pkg)

  let image = Image.base("node:22-bookworm")
    .runCommands(
      // Install system dependencies (curl for Goose download, git for agents, sudo for user)
      "apt-get update && apt-get install -y --no-install-recommends " +
        "curl ca-certificates git bzip2 sudo " +
        "&& rm -rf /var/lib/apt/lists/*"
    )

  // Install each npm package separately for better error isolation
  for (const pkg of npmPackages) {
    image = image.runCommands(`npm install -g ${pkg}`)
  }

  // Create daytona user (non-root) - Claude Code refuses to run as root
  image = image.runCommands(
    "useradd -m -s /bin/bash daytona || true && " +
      "echo 'daytona ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers"
  )

  // Install Goose binary
  const gooseCmd = getGooseInstallCmd()
  if (gooseCmd) {
    image = image.runCommands(gooseCmd)
  }

  // Create required directories and set up PATH for daytona user
  image = image
    .runCommands(
      "mkdir -p /home/daytona/.gemini /home/daytona/.config/goose /home/daytona/project && " +
        "chown -R daytona:daytona /home/daytona"
    )
    .runCommands(
      'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> /home/daytona/.bashrc'
    )
    // Set the default user to daytona
    .dockerfileCommands(["USER daytona"])
    .workdir("/home/daytona/project")

  return image
}
