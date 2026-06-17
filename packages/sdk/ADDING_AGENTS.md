# Adding a New Agent Integration

## Development Process

### 1. Read the CLI documentation

Understand installation method, auth env vars, JSON output flags, non-interactive/yolo flags, model selection flags, session resume flags.

### 2. Create agent module with `buildCommand` only

Create `src/agents/<provider>/`:

- `index.ts` — Implement `buildCommand()` returning CLI command and flags. Set `parse()` to `return null`
- `parser.ts` — Export a `parse<Provider>Line()` function that returns `null`
- `tools.ts` — Export `<PROVIDER>_TOOL_MAPPINGS = {}`

Export from `src/agents/index.ts`.

### 3. Run the script to generate reference JSONL

```bash
DAYTONA_API_KEY=... <PROVIDER>_API_KEY=... npx tsx scripts/generate-jsonl-references.ts <provider>
```

Output: `tests/fixtures/jsonl-reference/<provider>.jsonl`

### 4. Build parser and unit tests

Examine the JSONL to understand event structure.

**Exploration phase (tandem):** Iteratively add parsing logic to `parser.ts` and tests to `tests/parsers.test.ts`. You're discovering the format.

**Hardening phase (test-first):** Write tests first for edge cases (malformed JSON, missing fields, errors).

Update `tools.ts` with tool name mappings.

### 5. Integration tests

Add `tests/integration/<provider>.test.ts`.

```bash
DAYTONA_API_KEY=... <PROVIDER>_API_KEY=... npm test -- tests/integration/<provider>.test.ts
```

### 6. Update documentation

Update `README.md`: provider support table, CLI reference commands, model selection.
