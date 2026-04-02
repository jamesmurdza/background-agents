# Testing Guide

Quick reference for running the integration tests in this SDK.

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Environment Variables

Create a `.env` file or export these variables:

```bash
# Required for all tests
export DAYTONA_API_KEY="your-daytona-api-key"

# Required for Claude tests (primary)
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# Optional: for testing other providers
export OPENAI_API_KEY="your-openai-api-key"
export GEMINI_API_KEY="your-gemini-api-key"
```

Or use a `.env` file:
```bash
cp .env.example .env
# Edit .env with your keys
```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Only Integration Tests
```bash
npm test -- tests/integration/
```

### Run Specific Test Files

**Background session tests:**
```bash
npm test -- tests/integration/sandbox-background.test.ts
```

**Error handling tests:**
```bash
npm test -- tests/integration/error-handling.test.ts
```

**Provider tests:**
```bash
npm test -- tests/integration/providers.test.ts
```

### Run Specific Test Suites

Use the `-t` flag to match test descriptions:

```bash
# Only reattachment tests
npm test -- tests/integration/sandbox-background.test.ts -t "reattachment"

# Only timeout tests
npm test -- tests/integration/error-handling.test.ts -t "timeout"

# Only cancellation tests
npm test -- tests/integration/sandbox-background.test.ts -t "cancellation"
```

### Run in Watch Mode

For development, run tests in watch mode:
```bash
npm test -- --watch tests/integration/sandbox-background.test.ts
```

## Test Files Overview

| File | Tests | What It Tests |
|------|-------|---------------|
| `providers.test.ts` | ~10 | Basic streaming and background modes for all providers |
| `sandbox-background.test.ts` | 16 | Session lifecycle, reattachment, cancellation, crashes |
| `error-handling.test.ts` | 20 | Timeouts, invalid keys, edge cases, concurrent ops |

## Expected Test Duration

- **Quick test run** (~1 provider, ~3 tests): 2-5 minutes
- **Full background session tests**: 15-30 minutes
- **Full error handling tests**: 15-30 minutes
- **All integration tests**: 30-60 minutes

Tests are slower because they:
- Create real Daytona sandboxes
- Install provider CLIs in sandboxes
- Make real API calls to AI providers
- Wait for actual agent responses

## Test Timeouts

Individual test timeouts are set generously to accommodate real API calls:

- Simple tests: 30-90 seconds
- Standard tests: 120-180 seconds (2-3 minutes)
- Long-running tests: 180-300 seconds (3-5 minutes)

If tests timeout, it usually indicates:
- Sandbox creation issues
- Network problems
- API rate limiting
- Provider CLI installation failures

## Skipped Tests

Tests are automatically skipped when:
- `DAYTONA_API_KEY` is not set
- Required provider API key is missing
- Use `--no-skip` flag to run them anyway (they'll fail with clear errors)

## Debugging Failed Tests

### Enable Debug Logging

Set the `DEBUG` environment variable:
```bash
DEBUG=1 npm test -- tests/integration/sandbox-background.test.ts
```

This will show detailed logs from the SDK.

### Run a Single Test

```bash
npm test -- tests/integration/sandbox-background.test.ts -t "can reattach"
```

### Check Sandbox State

If a test fails, the sandbox might not be cleaned up. Check:
```bash
# List your Daytona sandboxes
daytona sandbox list
```

### Common Issues

**"Sandbox manager not configured"**
- Missing `DAYTONA_API_KEY`

**"Failed to install claude CLI"**
- Sandbox doesn't have internet access
- npm registry issues

**"Cannot get background session: meta not found"**
- No turn has been started yet
- Session ID doesn't exist

**Timeout errors**
- Increase timeout in test
- Check API rate limits
- Verify network connectivity

## CI/CD Integration

For GitHub Actions or similar:

```yaml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
        env:
          DAYTONA_API_KEY: ${{ secrets.DAYTONA_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Test Development Tips

### 1. Use Shared Sandboxes

Create one sandbox in `beforeAll()`, reuse across tests:
```typescript
describe("my tests", () => {
  let sandbox: Sandbox

  beforeAll(async () => {
    const daytona = new Daytona({ apiKey: DAYTONA_API_KEY! })
    sandbox = await daytona.create({ envVars: { ... } })
  }, 60_000)

  afterAll(async () => {
    await sandbox?.delete()
  }, 30_000)

  it("test 1", async () => {
    // use sandbox
  })
})
```

### 2. Use Helper Functions

Extract common patterns:
```typescript
async function pollUntilEnd(bg, timeoutMs = 120_000) {
  // polling logic
}

async function collectStreamEvents(session, prompt) {
  // collection logic
}
```

### 3. Set Appropriate Timeouts

- Sandbox creation: 60 seconds
- Simple prompts: 90-120 seconds
- Complex prompts: 180 seconds
- Cleanup: 30 seconds

### 4. Handle Cleanup

Always clean up resources:
```typescript
try {
  // test code
} finally {
  await sandbox?.delete()
}
```

## Writing New Tests

To add a new integration test:

1. **Create test file** in `tests/integration/`
2. **Import dependencies**:
   ```typescript
   import "dotenv/config"
   import { describe, it, expect, beforeAll, afterAll } from "vitest"
   import { Daytona, type Sandbox } from "@daytonaio/sdk"
   import { createSession, createBackgroundSession } from "../../src/index.js"
   ```
3. **Use conditional skip**:
   ```typescript
   describe.skipIf(!DAYTONA_API_KEY)("test suite", () => {
     // tests
   })
   ```
4. **Create sandbox once**, reuse across tests
5. **Set generous timeouts** for async operations
6. **Clean up** in `afterAll()`

## Performance Tips

- **Reuse sandboxes** within a test file (saves 30-60s per test)
- **Run tests in parallel** (Vitest does this by default)
- **Use smaller prompts** for faster responses
- **Skip installation** when possible (advanced)

## JSONL Reference Files

Raw JSONL output from each provider is captured in `tests/fixtures/jsonl-reference/`. These files show the native CLI output format before SDK normalization.

To regenerate:
```bash
npm run generate:jsonl-refs
```

Requires API keys for each provider you want to capture.

## Questions?

See:
- `NEW_TESTS.md` - Documentation of new tests
- `tests/integration/providers.test.ts` - Example test patterns
- `README.md` - SDK documentation
