/**
 * Agents module - registers all built-in agents
 *
 * Import this module to register all agents with the registry.
 */

import { registry } from "../core/registry"
import { claudeAgent } from "./claude/index"
import { codexAgent } from "./codex/index"
import { elizaAgent } from "./eliza/index"
import { geminiAgent } from "./gemini/index"
import { gooseAgent } from "./goose/index"
import { kiloAgent } from "./kilo/index"
import { hermesAgent } from "./hermes/index"
import { opencodeAgent } from "./opencode/index"
import { piAgent } from "./pi/index"

// Register all built-in agents
registry.register(claudeAgent)
registry.register(codexAgent)
registry.register(elizaAgent)
registry.register(geminiAgent)
registry.register(gooseAgent)
registry.register(kiloAgent)
registry.register(hermesAgent)
registry.register(opencodeAgent)
registry.register(piAgent)

// Export agent definitions for direct import if needed
export { claudeAgent } from "./claude/index"
export { codexAgent } from "./codex/index"
export { elizaAgent } from "./eliza/index"
export { geminiAgent } from "./gemini/index"
export { gooseAgent } from "./goose/index"
export { kiloAgent } from "./kilo/index"
export { hermesAgent } from "./hermes/index"
export { opencodeAgent } from "./opencode/index"
export { piAgent } from "./pi/index"

// Re-export tool mappings for testing
export { CLAUDE_TOOL_MAPPINGS } from "./claude/tools"
export { CODEX_TOOL_MAPPINGS } from "./codex/tools"
export { ELIZA_TOOL_MAPPINGS } from "./eliza/tools"
export { GEMINI_TOOL_MAPPINGS } from "./gemini/tools"
export { GOOSE_TOOL_MAPPINGS } from "./goose/tools"
export { KILO_TOOL_MAPPINGS } from "./kilo/tools"
export { OPENCODE_TOOL_MAPPINGS } from "./opencode/tools"
export { PI_TOOL_MAPPINGS } from "./pi/tools"

// Re-export parsers for testing
export { parseClaudeLine } from "./claude/parser"
export { parseCodexLine } from "./codex/parser"
export { parseElizaLine } from "./eliza/parser"
export { parseGeminiLine } from "./gemini/parser"
export { parseGooseLine } from "./goose/parser"
export { parseKiloLine } from "./kilo/parser"
export { parseHermesLine } from "./hermes/parser"
export { parseOpencodeLine } from "./opencode/parser"
export { parsePiLine } from "./pi/parser"
