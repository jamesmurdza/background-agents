/**
 * Agents module - registers all built-in agents
 *
 * Import this module to register all agents with the registry.
 */

import { registry } from "../core/registry"
import { claudeAgent } from "./claude/index"
import { codexAgent } from "./codex/index"
import { copilotAgent } from "./copilot/index"
import { elizaAgent } from "./eliza/index"
import { geminiAgent } from "./gemini/index"
import { gooseAgent } from "./goose/index"
import { kiloAgent } from "./kilo/index"
import { kimiAgent } from "./kimi/index"
import { opencodeAgent } from "./opencode/index"
import { piAgent } from "./pi/index"

// Register all built-in agents
registry.register(claudeAgent)
registry.register(codexAgent)
registry.register(copilotAgent)
registry.register(elizaAgent)
registry.register(geminiAgent)
registry.register(gooseAgent)
registry.register(kiloAgent)
registry.register(kimiAgent)
registry.register(opencodeAgent)
registry.register(piAgent)

// Export agent definitions for direct import if needed
export { claudeAgent } from "./claude/index"
export { codexAgent } from "./codex/index"
export { copilotAgent } from "./copilot/index"
export { elizaAgent } from "./eliza/index"
export { geminiAgent } from "./gemini/index"
export { gooseAgent } from "./goose/index"
export { kiloAgent } from "./kilo/index"
export { kimiAgent } from "./kimi/index"
export { opencodeAgent } from "./opencode/index"
export { piAgent } from "./pi/index"

// Re-export tool mappings for testing
export { CLAUDE_TOOL_MAPPINGS } from "./claude/tools"
export { CODEX_TOOL_MAPPINGS } from "./codex/tools"
export { COPILOT_TOOL_MAPPINGS } from "./copilot/tools"
export { ELIZA_TOOL_MAPPINGS } from "./eliza/tools"
export { GEMINI_TOOL_MAPPINGS } from "./gemini/tools"
export { GOOSE_TOOL_MAPPINGS } from "./goose/tools"
export { KILO_TOOL_MAPPINGS } from "./kilo/tools"
export { KIMI_TOOL_MAPPINGS } from "./kimi/tools"
export { OPENCODE_TOOL_MAPPINGS } from "./opencode/tools"
export { PI_TOOL_MAPPINGS } from "./pi/tools"

// Re-export parsers for testing
export { parseClaudeLine } from "./claude/parser"
export { parseCodexLine } from "./codex/parser"
export { parseCopilotLine } from "./copilot/parser"
export { parseElizaLine } from "./eliza/parser"
export { parseGeminiLine } from "./gemini/parser"
export { parseGooseLine } from "./goose/parser"
export { parseKiloLine } from "./kilo/parser"
export { parseKimiLine } from "./kimi/parser"
export { parseOpencodeLine } from "./opencode/parser"
export { parsePiLine } from "./pi/parser"
