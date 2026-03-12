import * as fs from "node:fs"
import * as path from "node:path"

/**
 * Session management utilities
 */

const DEFAULT_SESSION_DIR = ".coding-agents"
const DEFAULT_SESSION_FILE = "session"

/**
 * Get the default session file path
 */
export function getDefaultSessionPath(providerName: string): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "."
  return path.join(homeDir, DEFAULT_SESSION_DIR, `${providerName}-${DEFAULT_SESSION_FILE}`)
}

/**
 * Load a session ID from file
 */
export function loadSession(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8").trim() || null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Store a session ID to file
 */
export function storeSession(filePath: string, sessionId: string): boolean {
  try {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, sessionId)
    return true
  } catch {
    return false
  }
}

/**
 * Clear a session file
 */
export function clearSession(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}
