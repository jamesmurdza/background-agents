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

  return (
    Image.base("node:22-bookworm")
      // Install system dependencies
      .runCommands(
        "apt-get update && apt-get install -y --no-install-recommends " +
          "curl ca-certificates git bzip2 sudo " +
          "&& rm -rf /var/lib/apt/lists/*"
      )
      // Install npm packages
      .runCommands(`npm install -g ${npmPackages.join(" ")}`)
      // Create daytona user (non-root) - some agents refuse to run as root
      .runCommands(
        "useradd -m -s /bin/bash daytona || true && " +
          "echo 'daytona ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers"
      )
      // Run shell installers
      .runCommands(...shellInstallers)
      // Set up daytona user environment
      .runCommands(
        "chown -R daytona:daytona /home/daytona && " +
          'echo \'export PATH="$HOME/.local/bin:$PATH"\' >> /home/daytona/.bashrc'
      )
      .dockerfileCommands(["USER daytona"])
      .workdir("/home/daytona/project")
  )
}
