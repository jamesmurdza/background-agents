# Adding a New Agent Integration

## Development Process

### 1. Read the CLI documentation

Understand installation, authentication, and output format. Key questions:

- How do I run a prompt non-interactively?
- How do I get structured (JSON/JSONL) output?
- How do I skip permission prompts for autonomous execution?
- How do I specify a model and resume a session?

### 2. Create a minimal agent module

Create `src/agents/<provider>/` with:

- `index.ts` — Agent definition (install command, CLI flags)
- `parser.ts` — Output parser (skeleton initially)
- `tools.ts` — Tool name mappings

Export from `src/agents/index.ts`.

### 3. Generate reference JSONL

Capture real CLI output to `tests/fixtures/jsonl-reference/<provider>.jsonl`:

```bash
DAYTONA_API_KEY=... <PROVIDER>_API_KEY=... npx tsx scripts/generate-jsonl-references.ts <provider>
```

### 4. Build parser and unit tests

**Exploration phase (tandem):** Work iteratively — examine output, write a test, implement parsing, repeat. You're discovering the format.

**Hardening phase (test-first):** Once you understand the format, write tests first for edge cases (malformed JSON, missing fields, errors).

Add tests to `tests/parsers.test.ts`.

### 5. Integration tests

Test end-to-end in a Daytona sandbox. Add to `tests/integration/`.

```bash
DAYTONA_API_KEY=... <PROVIDER>_API_KEY=... npm test -- tests/integration/<provider>.test.ts
```

### 6. Update documentation

Update `README.md`: provider support table, CLI reference commands, model selection.
