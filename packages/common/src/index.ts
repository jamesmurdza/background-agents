/**
 * @upstream/common
 * Shared utilities and types for upstream-agents packages
 */

// Constants
export { PATHS, SANDBOX_CONFIG, TIMEOUTS } from "./constants.js"

// Types
export type {
  ContentBlock,
  ToolCall,
  AgentStatus,
  AgentStatusResponse,
} from "./types.js"

// Session utilities
export {
  mapToolName,
  buildSystemPrompt,
  buildContentBlocks,
  type BuildContentBlocksResult,
} from "./session.js"

// Agent configuration
export {
  // Types
  type Agent,
  type ProviderName,
  type ModelOption,
  type UserCredentialFlags,
  // Data
  agentToProvider,
  agentLabels,
  agentModels,
  defaultAgentModel,
  // Functions
  getProviderForAgent,
  getDefaultAgent,
  hasClaudeCodeCredentials,
  hasCodexCredentials,
  hasGeminiCredentials,
  hasGooseCredentials,
  hasPiCredentials,
  hasCredentialsForModel,
  getDefaultModelForAgent,
  getModelLabel,
} from "./agents.js"
