/**
 * OpenCode permissions configuration
 * Sets up permission rules that block dangerous git operations
 */

import fs from "fs"
import path from "path"
import type { Sandbox } from "@daytonaio/sdk"
import { PATHS } from "@/lib/constants"

// Load permissions config from the hooks directory at module load time
const HOOKS_DIR = path.join(process.cwd(), "hooks")
const OPENCODE_PERMISSIONS = JSON.parse(
  fs.readFileSync(path.join(HOOKS_DIR, "opencode-permissions.json"), "utf-8")
)

// OpenCode config path - used for OPENCODE_CONFIG env var
export const OPENCODE_CONFIG_PATH = PATHS.MCP_CONFIG["opencode"]

/**
 * Sets up OpenCode permissions in a sandbox.
 * Writes the permissions config to ~/.config/opencode/opencode.jsonc
 * The OPENCODE_CONFIG env var must be set when running opencode to use this config.
 */
export async function setupOpenCodePermissions(sandbox: Sandbox): Promise<void> {
  const configPath = OPENCODE_CONFIG_PATH
  const configDir = configPath.substring(0, configPath.lastIndexOf("/"))

  // Create the config directory
  await sandbox.process.executeCommand(`mkdir -p ${configDir}`)

  // Read existing config if present
  const existingResult = await sandbox.process.executeCommand(
    `cat ${configPath} 2>/dev/null || echo '{}'`
  ) as { result: string }

  let existing: Record<string, unknown> = {}
  try {
    // Strip JSONC comments before parsing
    const jsonContent = existingResult.result.trim().replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    existing = JSON.parse(jsonContent || "{}")
  } catch {
    existing = {}
  }

  // Deep merge permissions
  if (!existing.permission) existing.permission = {}
  const existingPermission = existing.permission as Record<string, unknown>

  for (const [tool, rules] of Object.entries(OPENCODE_PERMISSIONS.permission || {})) {
    if (typeof rules === "object" && rules !== null) {
      // Merge object-style rules
      if (!existingPermission[tool] || typeof existingPermission[tool] !== "object") {
        existingPermission[tool] = {}
      }
      const existingToolRules = existingPermission[tool] as Record<string, unknown>
      for (const [pattern, action] of Object.entries(rules as Record<string, unknown>)) {
        // Don't overwrite existing rules (user rules take precedence)
        if (!(pattern in existingToolRules)) {
          existingToolRules[pattern] = action
        }
      }
    } else {
      // Simple string rule
      if (!(tool in existingPermission)) {
        existingPermission[tool] = rules
      }
    }
  }

  // Write the merged config
  await sandbox.fs.uploadFile(
    Buffer.from(JSON.stringify(existing, null, 2), "utf-8"),
    configPath
  )

  // Set proper permissions
  await sandbox.process.executeCommand(`chmod 600 ${configPath}`)

  // Add OPENCODE_CONFIG to .bash_profile so it's available in login shells (bash -lc)
  // This works around an SDK bug where env vars don't propagate through nohup sh -c
  const exportLine = `export OPENCODE_CONFIG="${configPath}"`
  await sandbox.process.executeCommand(
    `grep -qF 'OPENCODE_CONFIG' ~/.bash_profile 2>/dev/null || echo '${exportLine}' >> ~/.bash_profile`
  )
}
