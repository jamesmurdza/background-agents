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
 * Builds the Daytona Image spec with all agent CLIs pre-installed.
 *
 * Automatically installs all providers from PROVIDER_PACKAGES and
 * PROVIDER_SHELL_INSTALLERS defined in background-agents.
 */
export function getAgentSandboxImage(): Image {
  // Get npm packages (filter out empty strings for built-in/shell-installed providers)
  const npmPackages = Object.values(PROVIDER_PACKAGES).filter((pkg) => pkg !== "")

  // Get shell installers, replacing ~ with absolute path
  const shellInstallers = Object.values(PROVIDER_SHELL_INSTALLERS)
    .filter((cmd): cmd is string => !!cmd)
    .map((cmd) => cmd.replace(/~/g, "/home/daytona"))

  let image = Image.base("node:22-bookworm").runCommands(
    // Install system dependencies
    "apt-get update && apt-get install -y --no-install-recommends " +
      "curl ca-certificates git bzip2 sudo " +
      "&& rm -rf /var/lib/apt/lists/*"
  )

  // Install each npm package separately for better error isolation
  for (const pkg of npmPackages) {
    image = image.runCommands(`npm install -g ${pkg}`)
  }

  // Create daytona user (non-root) - some agents refuse to run as root
  image = image.runCommands(
    "useradd -m -s /bin/bash daytona || true && " +
      "echo 'daytona ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers"
  )

  // Run shell installers (e.g., goose binary)
  for (const cmd of shellInstallers) {
    image = image.runCommands(cmd)
  }

  // Set up daytona user environment
  image = image
    .runCommands("chown -R daytona:daytona /home/daytona")
    .runCommands(
      'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> /home/daytona/.bashrc'
    )
    .dockerfileCommands(["USER daytona"])
    .workdir("/home/daytona/project")

  return image
}
