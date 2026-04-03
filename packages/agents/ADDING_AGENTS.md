# Adding a New Agent Integration

This guide walks through the process of adding support for a new CLI-based coding agent.

---

## Overview

Each agent integration consists of:

- **Agent module** (`src/agents/<provider>/`) — CLI configuration and command building
- **Parser** — Transforms provider-specific JSONL output into standardized events
- **Tool mappings** — Normalizes tool names across providers
- **Tests** — Unit tests for parsing, integration tests for end-to-end validation

---

## Development Process

### 1. Read the CLI documentation

Before writing any code, understand the target CLI:

- **Installation** — How to install the CLI (npm, binary, etc.)
- **Authentication** — What environment variables are required
- **Output format** — Does it support JSON/JSONL streaming output?
- **Flags** — What flags enable non-interactive/headless mode, JSON output, model selection, session resume, etc.

Key questions to answer:

- [ ] How do I run a prompt non-interactively?
- [ ] How do I get structured (JSON) output instead of human-readable text?
- [ ] How do I skip permission prompts for autonomous execution?
- [ ] How do I specify a model?
- [ ] How do I resume a session?

### 2. Create a minimal agent module

Create the directory structure:

```
src/agents/<provider>/
├── index.ts    # Agent definition
├── parser.ts   # Output parser (skeleton)
└── tools.ts    # Tool name mappings
```

Start with a minimal `index.ts` that can install and run the CLI:

```typescript
import type { AgentDefinition, CommandSpec, RunOptions } from "../../core/agent.js"
import type { Event } from "../../types/events.js"

export const myAgent: AgentDefinition = {
  name: "my-agent",

  toolMappings: {},

  capabilities: {
    supportsSystemPrompt: false,
    supportsResume: false,
  },

  buildCommand(options: RunOptions): CommandSpec {
    const args = ["run", "--json"]

    if (options.prompt) {
      args.push(options.prompt)
    }

    return {
      cmd: "my-cli",
      args,
      env: options.env,
    }
  },

  parse(line: string): Event | null {
    // Skeleton — just log for now
    console.log("RAW:", line)
    return null
  },
}
```

Register it in `src/agents/index.ts`:

```typescript
export { myAgent } from "./my-agent/index.js"
```

### 3. Generate reference JSONL

Run the CLI through the SDK and capture real output. Use the reference generation script:

```bash
DAYTONA_API_KEY=... MY_AGENT_API_KEY=... npx tsx scripts/generate-jsonl-references.ts my-agent
```

Or manually run the CLI and save output:

```bash
my-cli run --json "Create a hello world script" > tests/fixtures/jsonl-reference/my-agent.jsonl
```

The goal is to capture representative output covering:

- Text/token streaming
- Tool calls (start, progress, end)
- Successful completion
- Errors

### 4. Build parser and unit tests (in tandem)

This is an iterative process:

1. **Examine the captured JSONL** — Understand the event structure
2. **Write a test for one event type** — e.g., token streaming
3. **Implement that parsing logic** — Make the test pass
4. **Move to the next event type** — Tool calls, completion, etc.
5. **Repeat**

Example workflow:

```typescript
// tests/parsers.test.ts

describe("my-agent parser", () => {
  it("parses token events", () => {
    const line = '{"type":"text","content":"Hello"}'
    const event = parseMyAgentLine(line, {}, createContext())
    expect(event).toEqual({ type: "token", text: "Hello" })
  })

  it("parses tool start events", () => {
    const line = '{"type":"tool_use","name":"write_file","input":{...}}'
    const event = parseMyAgentLine(line, {}, createContext())
    expect(event).toEqual({ type: "tool_start", name: "write_file", input: {...} })
  })
})
```

#### Exploration phase (tandem)

When discovering the output format, work iteratively:

- Run the CLI with different prompts
- See what events are emitted
- Add parsing logic and tests together

#### Hardening phase (test-first)

Once you understand the format, write tests first for edge cases:

- Malformed JSON lines
- Missing fields
- Unexpected event types
- Error conditions

### 5. Integration tests

Test the full flow in a real Daytona sandbox:

```typescript
// tests/integration/my-agent.test.ts

describe("my-agent integration", () => {
  it("runs a simple task", async () => {
    const session = await createSession("my-agent", {
      sandbox,
      env: { MY_AGENT_API_KEY: process.env.MY_AGENT_API_KEY },
    })

    await session.start("Say hello")

    const events: Event[] = []
    while (await session.isRunning()) {
      const { events: newEvents } = await session.getEvents()
      events.push(...newEvents)
      await new Promise(r => setTimeout(r, 500))
    }

    expect(events.some(e => e.type === "token")).toBe(true)
    expect(events.some(e => e.type === "end")).toBe(true)
  })
})
```

Run with:

```bash
DAYTONA_API_KEY=... MY_AGENT_API_KEY=... npm test -- tests/integration/my-agent.test.ts
```

Use the interactive REPL for manual testing:

```bash
DAYTONA_API_KEY=... MY_AGENT_API_KEY=... npx tsx scripts/repl-polling.ts
```

### 6. Update documentation

Finally, update the README:

- Add to the **Provider support** table
- Add to the **CLI reference commands** table
- Add to the **Model selection** table
- Add to the **Resources** section

---

## File Structure Reference

```
packages/agents/
├── src/agents/
│   ├── index.ts                    # Exports all agents
│   └── <provider>/
│       ├── index.ts                # Agent definition (install, command building)
│       ├── parser.ts               # JSONL → Event parsing
│       └── tools.ts                # Tool name mappings
├── tests/
│   ├── parsers.test.ts             # Unit tests for all parsers
│   ├── fixtures/jsonl-reference/   # Captured CLI output samples
│   │   └── <provider>.jsonl
│   └── integration/
│       └── <provider>.test.ts      # End-to-end sandbox tests
└── scripts/
    └── generate-jsonl-references.ts # Capture real CLI output
```

---

## Event Types

Your parser should emit these standardized events:

| Event | Description | Fields |
|-------|-------------|--------|
| `session` | Session started | `id: string` |
| `token` | Streamed text | `text: string` |
| `tool_start` | Tool invoked | `name: string`, `input?: unknown` |
| `tool_delta` | Tool streaming | `text: string` |
| `tool_end` | Tool finished | `output?: string` |
| `end` | Task complete | `error?: string` |

---

## Tips

- **Start simple** — Get basic token streaming working first
- **Use debug mode** — Set `CODING_AGENTS_DEBUG=1` to see raw output
- **Check existing agents** — Reference `claude/`, `codex/`, `gemini/`, `opencode/` for patterns
- **Handle noise** — CLIs often emit non-JSON lines (progress spinners, warnings); skip gracefully
