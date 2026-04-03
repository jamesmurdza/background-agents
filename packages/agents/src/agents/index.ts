/**
 * Agents module - registers all built-in agents
 *
 * Import this module to register all agents with the registry.
 */

import { registry } from "../core/registry.js"
import { claudeAgent } from "./claude/index.js"
import { codexAgent } from "./codex/index.js"
import { geminiAgent } from "./gemini/index.js"
import { opencodeAgent } from "./opencode/index.js"
import { picocodeAgent } from "./picocode/index.js"

// Register all built-in agents
registry.register(claudeAgent)
registry.register(codexAgent)
registry.register(geminiAgent)
registry.register(opencodeAgent)
registry.register(picocodeAgent)

// Export agent definitions for direct import if needed
export { claudeAgent } from "./claude/index.js"
export { codexAgent } from "./codex/index.js"
export { geminiAgent } from "./gemini/index.js"
export { opencodeAgent } from "./opencode/index.js"
export { picocodeAgent } from "./picocode/index.js"

// Re-export tool mappings for testing
export { CLAUDE_TOOL_MAPPINGS } from "./claude/tools.js"
export { CODEX_TOOL_MAPPINGS } from "./codex/tools.js"
export { GEMINI_TOOL_MAPPINGS } from "./gemini/tools.js"
export { OPENCODE_TOOL_MAPPINGS } from "./opencode/tools.js"
export { PICOCODE_TOOL_MAPPINGS } from "./picocode/tools.js"

// Re-export parsers for testing
export { parseClaudeLine } from "./claude/parser.js"
export { parseCodexLine } from "./codex/parser.js"
export { parseGeminiLine } from "./gemini/parser.js"
export { parseOpencodeLine } from "./opencode/parser.js"
export { parsePicocodeLine } from "./picocode/parser.js"
