# Implementation Plan: OpenCode Support with Agent/Model Selection UI

## Overview

Add OpenCode support using the `@jamesmurdza/coding-agents-sdk` and create a simple UI that:
1. Turns the "Claude Code" label under the prompt bar into a dropdown to select agents
2. Adds a models dropdown to the right side
3. Lets users select agent/model when creating a new branch (before starting chat)

## Current State

- SDK already supports: `claude`, `codex`, `opencode`, `gemini`
- Database schema already has `agent` and `model` fields on Branch
- UserCredentials already has `anthropicApiKey` and `openaiApiKey` fields
- The "Claude Code" label is in `chat-input.tsx` (line 93-96)
- Branch creation is in `branch-list.tsx`

## Key Insight: Agent Selection at Branch Creation

Users should select the agent when creating a branch because:
1. The sandbox needs to know which CLI to install
2. The session is tied to a specific agent
3. Changing agents mid-conversation would break context

Model selection can happen at branch creation OR be changed later (for Claude: sonnet/opus/haiku).

## Implementation Steps

### Phase 1: Update Types and Constants

**File: `/lib/types.ts`**
- Update `Agent` type to include: `"claude" | "opencode"`
- Add `agentLabels` mapping for display names
- Add model options per agent

**File: `/lib/constants.ts`**
- Add `AGENTS` constant with available agents
- Add `MODELS_BY_AGENT` mapping agent → available models
- Add default models per agent

### Phase 2: Update Database/Credentials

**File: `/prisma/schema.prisma`**
- Already has `agent` and `model` on Branch ✓
- Already has `openaiApiKey` on UserCredentials ✓
- Add `openrouterApiKey` field for OpenRouter support

**File: `/lib/sandbox-resume.ts`**
- Update `ensureSandboxReady` to pass OpenAI/OpenRouter keys based on agent
- Handle OpenCode-specific env vars

### Phase 3: Update Agent Session Layer

**File: `/lib/agent-session.ts`**
- Update `createBackgroundSession` to accept agent type
- Pass correct provider to SDK based on agent
- Handle different env vars per agent

### Phase 4: Branch Creation UI

**File: `/components/branch-list.tsx`**
- Add agent selector dropdown to "Create Branch" dialog
- Add model selector dropdown (filtered by selected agent)
- Default to "claude" agent and "sonnet" model
- Store selections when creating branch

### Phase 5: Chat Input UI - Agent/Model Display

**File: `/components/chat/chat-input.tsx`**
- Replace static "Claude Code" label with a display showing current agent
- Add model indicator on the right side
- Both are read-only displays (can't change mid-conversation)
- Show appropriate icon per agent

### Phase 6: API Routes

**File: `/app/api/agent/execute/route.ts`**
- Read agent type from branch
- Pass agent type to session creation
- Handle different credential requirements per agent

**File: `/app/api/branches/route.ts`**
- Accept `agent` and `model` in POST body
- Validate agent/model combinations

**File: `/app/api/user/credentials/route.ts`**
- Handle OpenRouter API key storage/retrieval

### Phase 7: Credentials Settings

**File: `/components/settings-modal.tsx`**
- Add OpenRouter API key field
- Show which agents are available based on configured keys
- Explain: Claude works with Anthropic/OpenAI/OpenRouter keys
- Explain: OpenCode works with Anthropic/OpenAI/OpenRouter OR free with big-pickle

## Agent Configuration Details

### Claude Code
- **Auth options**: `ANTHROPIC_API_KEY` OR `OPENAI_API_KEY` (via OpenRouter) OR Claude Max
- **Models**: `sonnet`, `opus`, `haiku`
- **Default model**: `sonnet`

### OpenCode
- **Auth options**:
  - `ANTHROPIC_API_KEY` → models like `anthropic/claude-sonnet`
  - `OPENAI_API_KEY` → models like `openai/gpt-4o`
  - `OPENROUTER_API_KEY` → any OpenRouter model
  - Free (no key) → uses big-pickle provider
- **Models**: `anthropic/claude-sonnet`, `openai/gpt-4o`, `openrouter/...`, etc.
- **Default model**: `anthropic/claude-sonnet` (if Anthropic key) or free tier

## UI Design

### Branch Creation Dialog
```
┌─────────────────────────────────────────┐
│ Create Branch                           │
├─────────────────────────────────────────┤
│ Branch from: [main ▼]                   │
│                                         │
│ Agent: [Claude Code ▼] Model: [Sonnet ▼]│
│                                         │
│ [Cancel]              [Create Branch]   │
└─────────────────────────────────────────┘
```

### Chat Input (after branch creation)
```
┌─────────────────────────────────────────┐
│ [Type your message...              ] [→]│
├─────────────────────────────────────────┤
│ 🖥 Claude Code                  Sonnet  │
└─────────────────────────────────────────┘
```

## Files to Modify

1. `/lib/types.ts` - Add agent/model types
2. `/lib/constants.ts` - Add agent/model constants
3. `/prisma/schema.prisma` - Add openrouterApiKey (migration needed)
4. `/lib/sandbox-resume.ts` - Handle multi-agent credentials
5. `/lib/agent-session.ts` - Support multiple agents
6. `/components/branch-list.tsx` - Agent/model selection in create dialog
7. `/components/chat/chat-input.tsx` - Display current agent/model
8. `/app/api/agent/execute/route.ts` - Multi-agent execution
9. `/app/api/branches/route.ts` - Accept agent/model params
10. `/app/api/user/credentials/route.ts` - OpenRouter key support
11. `/components/settings-modal.tsx` - OpenRouter key input

## Migration Plan

1. Add `openrouterApiKey` to UserCredentials schema
2. Run `npx prisma db push` or create migration
3. Existing branches default to `agent: "claude"` (already in schema)

## Testing Plan

1. Create branch with Claude Code + Sonnet → verify execution
2. Create branch with OpenCode + anthropic/claude-sonnet → verify execution
3. Test with no API keys → OpenCode should work with free tier
4. Verify credentials are passed correctly to sandbox
5. Verify model display in chat input updates correctly
