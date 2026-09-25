# Adding a New Agent Integration

## Development Process

### 1. Read the CLI documentation

Understand installation method, auth env vars, JSON output flags, non-interactive/yolo flags, model selection flags, session resume flags.

### 2. Create agent module with `buildCommand` only

Create `src/agents/<provider>/`:

- `index.ts` — Implement `buildCommand()` returning CLI command and flags. Set `parse()` to `return null`
- `parser.ts` — Export a `parse<Provider>Line()` function that returns `null`
- `tools.ts` — Export `<PROVIDER>_TOOL_MAPPINGS = {}`

Then wire it up. All of these are required, not optional:

- `src/types/provider.ts` — add the name to the `ProviderName` union. It is a closed union, so nothing else typechecks until you do
- `src/utils/install.ts` — add an entry to `PROVIDER_PACKAGES` (it's a total `Record<ProviderName, string>`, so an entry is compulsory; use `""` for non-npm agents) and, for non-npm agents, a `PROVIDER_SHELL_INSTALLERS` command. With neither, `ensureProvider()` silently skips installation and the run fails on a missing CLI
- `src/agents/index.ts` — `registry.register(<provider>Agent)` and re-export the agent
- The installed binary must be named the same as the agent (`src/sandbox/daytona.ts` probes with `which <agentName>`), or add a special case there

### 3. Run the script to generate reference JSONL

First add a `ProviderConfig` entry for the agent to the `providers` array in
`scripts/generate-jsonl-references.ts` — the script validates its argument against
that array and exits with `Unknown provider: <name>` otherwise.

```bash
DAYTONA_API_KEY=... <PROVIDER>_API_KEY=... npx tsx scripts/generate-jsonl-references.ts <provider>
```

Output: `tests/fixtures/jsonl-reference/<provider>.jsonl`

### 4. Build parser and unit tests

Examine the JSONL to understand event structure.

**Exploration phase (tandem):** Iteratively add parsing logic to `parser.ts` and tests to `tests/parsers/<provider>.test.ts` (one file per agent; shared helpers live in `tests/parsers/helpers.ts`). You're discovering the format.

**Hardening phase (test-first):** Write tests first for edge cases (malformed JSON, missing fields, errors).

Update `tools.ts` with tool name mappings.

### 5. Integration tests

Integration coverage is table-driven — add an entry for the agent to the `agents`
array in `tests/integration/providers.test.ts` (`name`, `apiKeyEnvVar`, `apiKey`,
`hasKey`, and an optional `model`). There is no per-provider integration file.

```bash
DAYTONA_API_KEY=... <PROVIDER>_API_KEY=... npm test -- tests/integration/providers.test.ts
```

### 6. Update documentation

Update `README.md`: provider support table, CLI reference commands, model selection.
