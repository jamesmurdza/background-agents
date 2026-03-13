# Plan: Replace Python Agent Code with `@jamesmurdza/coding-agents-sdk`

## Overview

Replace the current Python-based agent execution (embedded Python scripts + `claude-agent-sdk` pip package) with the TypeScript-native `@jamesmurdza/coding-agents-sdk` npm package.

**Benefits:**
- No Python dependency - everything runs natively in TypeScript/Node.js
- Full TypeScript type safety for all events
- Cleaner code - no base64-encoded Python script strings
- Native async generator streaming instead of stdout parsing
- Multi-provider ready (Claude, Codex, OpenCode, Gemini)
- SDK handles session persistence, CLI installation, and sandbox adaptation

---

## Files to ADD

### 1. `package.json` - Add dependency
```json
"@jamesmurdza/coding-agents-sdk": "^latest"
```
**Note:** Package is not yet published to npm. May need to install from GitHub:
```json
"@jamesmurdza/coding-agents-sdk": "github:jamesmurdza/coding-agents"
```

### 2. `lib/agent-session.ts` (NEW ~120 lines)
Wrapper module providing:

```typescript
import {
  createSession,
  createBackgroundSession,
  getBackgroundSession,
  adaptDaytonaSandbox,
  ensureCliInstalled,
  type Event,
  type TokenEvent,
  type ToolStartEvent,
  type EndEvent,
} from '@jamesmurdza/coding-agents-sdk'

// Build system prompt (same as current Python version)
export function buildSystemPrompt(repoPath: string, previewUrlPattern?: string): string

// Create a streaming session for real-time queries
export async function createAgentSession(sandbox, options: {
  repoPath: string
  previewUrlPattern?: string
  sessionId?: string
  model?: string
})

// Run a query and yield events
export async function* runAgentQuery(session, prompt: string): AsyncGenerator<AgentEvent>

// Start a background agent execution
export async function startBackgroundAgent(sandbox, options: {
  prompt: string
  repoPath: string
  previewUrlPattern?: string
  sessionId?: string
}): Promise<{ executionId: string; backgroundSessionId: string }>

// Poll background agent for results
export async function pollBackgroundAgent(sandbox, backgroundSessionId: string): Promise<{
  status: 'running' | 'completed' | 'error'
  content: string
  toolCalls: Array<{ tool: string; summary: string }>
  contentBlocks: Array<{ type: string; text?: string; toolCalls?: Array }>
  error?: string
  sessionId?: string
}>

// Transform SDK events to current output format
export function transformEvent(event: Event): AgentEvent

// Map SDK tool names to current UI names
export function mapToolName(sdkTool: string): string
```

**Tool Name Mapping:**
| SDK Tool | Current UI |
|----------|------------|
| `shell`  | `Bash`     |
| `write`  | `Write`    |
| `read`   | `Read`     |
| `edit`   | `Edit`     |
| `glob`   | `Glob`     |
| `grep`   | `Grep`     |

---

## Files to REMOVE

### 1. `lib/coding-agent-script.ts` ❌ DELETE
- 103 lines of embedded Python code
- Exports `CODING_AGENT_SCRIPT` constant
- No longer needed - SDK handles agent execution natively

### 2. `lib/background-agent-script.ts` ❌ DELETE
- 171 lines including `getBackgroundAgentScript()` and `getOutputFilePath()`
- No longer needed - SDK's `createBackgroundSession()` replaces this
- **Note:** `getOutputFilePath()` function is used in `status/route.ts` - will be replaced with SDK's polling

---

## Files to MODIFY

### 1. `lib/sandbox-resume.ts`

**Current responsibilities:**
- Start/resume sandbox
- Upload Python script to `/tmp/coding_agent.py`
- Install `claude-agent-sdk` pip package
- Create code interpreter context
- Handle Claude credentials

**Changes:**

```diff
- import { CODING_AGENT_SCRIPT } from "@/lib/coding-agent-script"
+ import { ensureCliInstalled, adaptDaytonaSandbox } from '@jamesmurdza/coding-agents-sdk'

export async function ensureSandboxReady(...) {
  // Keep: sandbox start/resume logic
  // Keep: session ID retrieval from /home/daytona/.agent_session_id
  // Keep: Claude Max credentials handling

- // REMOVE: Python script upload (lines 69-78)
- const checkScript = await sandbox.process.executeCommand(...)
- const scriptB64 = Buffer.from(CODING_AGENT_SCRIPT).toString("base64")
- await sandbox.process.executeCommand(`echo '${scriptB64}' | base64 -d > /tmp/coding_agent.py`)

- // REMOVE: pip install (lines 80-83)
- await sandbox.process.executeCommand("python3 -c 'import claude_agent_sdk' 2>/dev/null || ...")

+ // ADD: Install Claude CLI in sandbox
+ const adaptedSandbox = adaptDaytonaSandbox(sandbox)
+ await ensureCliInstalled(adaptedSandbox, 'claude')

- // REMOVE: Code interpreter context creation (lines 93-116)
- const ctx = await sandbox.codeInterpreter.createContext(repoPath)
- const initResult = await sandbox.codeInterpreter.runCode(...)

+ // Return sandbox ready for SDK usage
+ return { sandbox, adaptedSandbox, wasResumed, resumeSessionId }
}
```

**Simplified return type:**
```typescript
return {
  sandbox,           // Raw Daytona sandbox
  adaptedSandbox,    // SDK-wrapped sandbox
  wasResumed: boolean,
  resumeSessionId?: string
}
```

Remove `contextId` from return - no longer needed.

---

### 2. `app/api/agent/execute/route.ts`

**Current flow:**
1. Authenticate, get sandbox
2. `ensureSandboxReady()` - uploads Python script
3. Generate execution ID
4. Create `AgentExecution` record
5. Upload background Python script via base64
6. Start `nohup python3 /tmp/bg_agent_*.py`
7. Return execution ID

**New flow:**

```diff
- import { getBackgroundAgentScript, getOutputFilePath } from "@/lib/background-agent-script"
+ import { startBackgroundAgent } from "@/lib/agent-session"
+ import { adaptDaytonaSandbox } from '@jamesmurdza/coding-agents-sdk'

export async function POST(req: Request) {
  // Keep: auth, validation, get sandbox record
  // Keep: decrypt credentials
  // Keep: ensureSandboxReady() call (modified version)

- // REMOVE: Generate execution ID (SDK generates this)
- const executionId = randomUUID()

- // REMOVE: Upload script (lines 98-103)
- const scriptContent = getBackgroundAgentScript(executionId)
- const scriptB64 = Buffer.from(scriptContent).toString("base64")
- await sandbox.process.executeCommand(`echo '${scriptB64}' | base64 -d > ...`)

- // REMOVE: Build env vars string (lines 105-120)
- const envVars: string[] = [...]
- const envString = envVars.join(" ")

- // REMOVE: nohup command (lines 122-126)
- const command = `cd ${repoPath} && ${envString} nohup python3 ...`
- await sandbox.process.executeCommand(command)

+ // ADD: Use SDK's background session
+ const { executionId, backgroundSessionId } = await startBackgroundAgent(
+   adaptedSandbox,
+   {
+     prompt,
+     repoPath,
+     previewUrlPattern: previewUrlPattern || sandboxRecord.previewUrlPattern,
+     sessionId: resumeSessionId,
+   }
+ )

  // Keep: Create AgentExecution record (use SDK's executionId)
  await prisma.agentExecution.create({
    data: {
      messageId,
      sandboxId,
      executionId,
+     backgroundSessionId,  // Store for polling
      status: "running",
    },
  })

  return Response.json({
    success: true,
    executionId,
+   backgroundSessionId,
    messageId,
  })
}
```

**Database schema consideration:** May need to add `backgroundSessionId` column to `AgentExecution` table for polling, OR use `executionId` as the background session ID.

---

### 3. `app/api/agent/status/route.ts`

**Current flow:**
1. Find execution record
2. Read JSON file via `cat /tmp/agent_output_*.json`
3. Parse JSON, return status

**New flow:**

```diff
- import { getOutputFilePath } from "@/lib/background-agent-script"
+ import { pollBackgroundAgent } from "@/lib/agent-session"
+ import { adaptDaytonaSandbox } from '@jamesmurdza/coding-agents-sdk'

export async function POST(req: Request) {
  // Keep: auth, find execution record

- // REMOVE: Manual file reading (lines 84-108)
- const outputFile = getOutputFilePath(execution.executionId)
- const result = await sandboxInstance.process.executeCommand(`cat "${outputFile}" ...`)
- outputData = JSON.parse(result.result.trim())

+ // ADD: Use SDK polling
+ const adaptedSandbox = adaptDaytonaSandbox(sandboxInstance)
+ const outputData = await pollBackgroundAgent(
+   adaptedSandbox,
+   execution.backgroundSessionId || execution.executionId
+ )

  // Keep: DB updates on completion (lines 113-158)
  // Keep: Return response format (same structure)
}
```

---

### 4. `app/api/agent/query/route.ts`

**Current flow:**
1. Ensure sandbox ready (creates code interpreter context)
2. Run Python via `sandbox.codeInterpreter.runCode()`
3. Parse stdout for `SESSION_ID:` and `TOOL_USE:` prefixes
4. Stream SSE events to client

**New flow:**

```diff
- import { ensureSandboxReady } from "@/lib/sandbox-resume"
+ import { createAgentSession, runAgentQuery, transformEvent } from "@/lib/agent-session"
+ import { adaptDaytonaSandbox } from '@jamesmurdza/coding-agents-sdk'

export async function POST(req: Request) {
  // Keep: auth, validation, get sandbox record

  const stream = new ReadableStream({
    async start(controller) {
-     // REMOVE: ensureSandboxReady() with context
-     const { sandbox, contextId, wasResumed, resumeSessionId } = await ensureSandboxReady(...)

+     // ADD: Create SDK session
+     const { sandbox, adaptedSandbox, resumeSessionId } = await ensureSandboxReady(...)
+     const session = await createAgentSession(adaptedSandbox, {
+       repoPath,
+       previewUrlPattern,
+       sessionId: resumeSessionId,
+     })

-     // REMOVE: Code interpreter execution (lines 147-187)
-     const result = await sandbox.codeInterpreter.runCode(
-       `coding_agent.run_query_sync(os.environ.get('PROMPT', ''))`,
-       { context: ctx, envs: {...}, onStdout: (msg) => {...} }
-     )

+     // ADD: Stream SDK events
+     for await (const event of runAgentQuery(session, prompt)) {
+       // Transform SDK event to current format
+       const transformed = transformEvent(event)
+
+       if (transformed.type === 'token') {
+         accumulatedContent += transformed.content
+         send({ type: "stdout", content: transformed.content })
+       } else if (transformed.type === 'tool') {
+         accumulatedToolCalls.push(transformed.toolCall)
+         send({ type: "stdout", content: `TOOL_USE:${transformed.toolCall.summary}\n` })
+       } else if (transformed.type === 'session') {
+         send({ type: "session-id", sessionId: transformed.sessionId })
+       } else if (transformed.type === 'error') {
+         send({ type: "error", message: transformed.message })
+       }
+     }

      send({ type: "done" })
    }
  })
}
```

---

## Event Transformation

The SDK produces typed events that need mapping to current format:

```typescript
// lib/agent-session.ts
export function transformEvent(event: Event): AgentEvent {
  if (event.type === 'token') {
    return { type: 'token', content: event.text }
  }
  if (event.type === 'tool_start') {
    const tool = mapToolName(event.name)  // 'shell' → 'Bash'
    const detail = getToolDetail(event.input)
    return {
      type: 'tool',
      toolCall: { tool, summary: `${tool}: ${detail}` }
    }
  }
  if (event.type === 'session') {
    return { type: 'session', sessionId: event.id }
  }
  if (event.type === 'end') {
    return { type: 'done' }
  }
  // ... etc
}

function mapToolName(sdkTool: string): string {
  const map: Record<string, string> = {
    shell: 'Bash',
    write: 'Write',
    read: 'Read',
    edit: 'Edit',
    glob: 'Glob',
    grep: 'Grep',
  }
  return map[sdkTool] || sdkTool
}
```

---

## ContentBlocks Reconstruction

**Additional wrapper logic needed:** The current Python code builds a `contentBlocks` array that interleaves text and tool calls in order for the UI:

```json
{
  "contentBlocks": [
    { "type": "text", "text": "Let me check the file..." },
    { "type": "tool_calls", "toolCalls": [{ "tool": "Read", "summary": "Read: package.json" }] },
    { "type": "text", "text": "I found the dependency..." }
  ]
}
```

The SDK emits separate events (`TokenEvent`, `ToolStartEvent`, etc.), so we need to reconstruct this structure in `lib/agent-session.ts`:

```typescript
// In pollBackgroundAgent or event accumulation logic
function buildContentBlocks(events: Event[]): ContentBlock[] {
  const blocks: ContentBlock[] = []
  let pendingText = ""
  let pendingToolCalls: ToolCall[] = []

  for (const event of events) {
    if (event.type === 'token') {
      // Flush pending tool calls before adding text
      if (pendingToolCalls.length > 0) {
        blocks.push({ type: 'tool_calls', toolCalls: pendingToolCalls })
        pendingToolCalls = []
      }
      pendingText += event.text
    } else if (event.type === 'tool_start') {
      // Flush pending text before adding tool call
      if (pendingText) {
        blocks.push({ type: 'text', text: pendingText })
        pendingText = ""
      }
      pendingToolCalls.push({
        tool: mapToolName(event.name),
        summary: `${mapToolName(event.name)}: ${getToolDetail(event.input)}`
      })
    }
  }

  // Flush remaining
  if (pendingToolCalls.length > 0) {
    blocks.push({ type: 'tool_calls', toolCalls: pendingToolCalls })
  }
  if (pendingText) {
    blocks.push({ type: 'text', text: pendingText })
  }

  return blocks
}
```

This is straightforward logic (~30 lines) to add in the wrapper.

---

## Session ID Persistence

**Verify needed:** Current code writes session ID to `/home/daytona/.agent_session_id` for persistence across sandbox restarts:

```python
with open('/home/daytona/.agent_session_id', 'w') as f:
    f.write(sid)
```

Need to confirm if SDK does this automatically. If not, add in wrapper:

```typescript
// In agent-session.ts after receiving SessionEvent
if (event.type === 'session') {
  await sandbox.process.executeCommand(
    `echo '${event.id}' > /home/daytona/.agent_session_id`
  )
}
```

---

## Database Changes (Optional)

Consider adding to `AgentExecution` model:
```prisma
model AgentExecution {
  // existing fields...
  backgroundSessionId String?  // For SDK background session polling
}
```

Alternatively, reuse `executionId` as the background session ID if SDK allows custom IDs.

---

## Migration Checklist

| Step | Action | Files |
|------|--------|-------|
| 1 | Add npm dependency | `package.json` |
| 2 | Create agent session wrapper | `lib/agent-session.ts` (NEW) |
| 3 | Update sandbox resume | `lib/sandbox-resume.ts` |
| 4 | Update execute route | `app/api/agent/execute/route.ts` |
| 5 | Update status route | `app/api/agent/status/route.ts` |
| 6 | Update query route | `app/api/agent/query/route.ts` |
| 7 | Delete Python scripts | `lib/coding-agent-script.ts`, `lib/background-agent-script.ts` |
| 8 | Test all flows | Manual testing |

---

## Line Count Impact

| Action | Lines |
|--------|-------|
| Remove `coding-agent-script.ts` | -103 |
| Remove `background-agent-script.ts` | -171 |
| Simplify `sandbox-resume.ts` | ~-50 |
| Simplify API routes | ~-60 |
| Add `agent-session.ts` | +120 |
| **Net change** | **~-260 lines** |

---

## Authentication

**✅ Confirmed Compatible** - The SDK supports both authentication methods:

1. **API Key**: Pass `ANTHROPIC_API_KEY` environment variable
2. **Claude Max OAuth**: Write credentials to `/home/daytona/.claude/.credentials.json`

The current code already writes Claude Max OAuth tokens to the correct location (`/home/daytona/.claude/.credentials.json`), so no changes are needed for authentication. Credentials must be pre-configured in the sandbox before creating a session.

**Current auth flow (unchanged):**
```typescript
// In sandbox-resume.ts - this stays the same
if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
  const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
  await sandbox.process.executeCommand(
    `mkdir -p /home/daytona/.claude && echo '${credentialsB64}' | base64 -d > /home/daytona/.claude/.credentials.json && chmod 600 /home/daytona/.claude/.credentials.json`
  )
}
```

---

## Risks & Considerations

1. **Package not published**: Install from GitHub until npm publish
2. ~~**Claude Max auth**: Verify SDK supports Claude Max credentials~~ ✅ Confirmed compatible
3. **Session ID format**: Ensure SDK session IDs are compatible with current DB storage
4. **Event format differences**: May need adjustment to frontend if event format changes
5. **Breaking changes**: SDK is pre-1.0, API may change

---

## Verification Plan

1. **Unit test**: Create test sandbox, run simple query, verify events
2. **Background execution**: Start background agent, poll until complete
3. **Session resumption**: Run query, get session ID, resume in new query
4. **Error handling**: Verify errors are properly surfaced
5. **Frontend compatibility**: Ensure SSE events still work with existing frontend

---

## SDK Changes Required

~~The following changes need to be made to `@jamesmurdza/coding-agents-sdk` before migration:~~

### ~~1. Add `systemPrompt` option~~ ✅ DONE

**Status:** ✅ Implemented in SDK

The SDK now supports `systemPrompt` in:
- `SessionOptions` interface
- `RunOptions` interface
- `ClaudeProvider.getCommand()` - uses native `--system-prompt` CLI flag

```typescript
// Usage:
const session = await createSession('claude', {
  sandbox: adaptedSandbox,
  systemPrompt: `You are an AI coding agent running in a Daytona sandbox...`,
  model: 'claude-sonnet-4-20250514',
})
```

---

## Open Questions

All resolved! ✅

1. ~~**Claude Max Authentication**~~: ✅ Resolved - SDK supports OAuth tokens at `/home/daytona/.claude/.credentials.json`

2. ~~**Custom Session IDs**~~: ✅ Resolved - Must use SDK-generated IDs, but this is fine. We simply store the SDK's session ID in `AgentExecution.executionId` instead of generating our own `randomUUID()`. No schema changes needed.

3. ~~**npm Package Status**~~: ✅ Install from GitHub for now: `"github:jamesmurdza/coding-agents"`

4. ~~**System Prompt**~~: ✅ Resolved - SDK now has `systemPrompt` option in `SessionOptions`.
