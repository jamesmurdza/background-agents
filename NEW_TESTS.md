# New Integration Tests

This document describes the high-priority integration tests added to improve test coverage for the background-agents SDK.

## Added Test Files

### 1. `tests/integration/sandbox-background.test.ts` (13KB, ~400 lines)

Comprehensive tests for background session lifecycle and advanced features.

#### Test Coverage:

**Session Reattachment (3 tests)**
- ✅ Reattach to existing background session using `getBackgroundSession()`
- ✅ Verify provider info is preserved in meta.json
- ✅ Error handling when reattaching to non-existent session

**Multiple Turns (2 tests)**
- ✅ Handle 3+ sequential prompts correctly
- ✅ Cursor advancement between turns

**Cancellation (3 tests)**
- ✅ Cancel running background process with `cancel()`
- ✅ Cancel is safe when nothing is running
- ✅ Can start new turn after cancellation

**Crash Detection (1 test)**
- ✅ Detect when process crashes unexpectedly (kill -9)
- ✅ Emit `agent_crashed` event with message

**Concurrent Polling (2 tests)**
- ✅ Multiple `getEvents()` calls return consistent results
- ✅ Reattached sessions see same state

**Process Lifecycle (3 tests)**
- ✅ `isRunning()` transitions: false → true → false
- ✅ `getPid()` returns null → pid → null
- ✅ Events are cumulative across `getEvents()` calls

**Edge Cases (2 tests)**
- ✅ Empty prompt handling
- ✅ Very long prompt (500+ words)

---

### 2. `tests/integration/error-handling.test.ts` (14KB, ~450 lines)

Tests for error handling, edge cases, and graceful degradation.

#### Test Coverage:

**Timeout Handling (2 tests)**
- ✅ Respect timeout in streaming mode
- ✅ Handle timeout in background mode
- ✅ Verify process stops after timeout

**Invalid API Keys (2 tests)**
- ✅ Fail gracefully with invalid key in streaming mode
- ✅ Fail gracefully with invalid key in background mode
- ✅ Proper error events emitted

**Missing API Keys (1 test)**
- ✅ Handle missing API key in environment
- ✅ Appropriate error messages

**Malformed Events (1 test)**
- ✅ Handle non-JSON output gracefully
- ✅ Don't crash on malformed lines

**Network Failures (1 test)**
- ✅ Handle sandbox connection issues
- ✅ Recovery from network hiccups during polling

**Empty and Edge Case Prompts (5 tests)**
- ✅ Empty string prompt
- ✅ Whitespace-only prompt
- ✅ Special characters: `<>&"'`$(){}`
- ✅ Newlines and escape sequences
- ✅ Very long prompts (>10K characters)

**Rapid Operations (2 tests)**
- ✅ Rapid `getEvents()` calls without crashing
- ✅ Rapid `isRunning()` calls

**Session Lifecycle Edge Cases (4 tests)**
- ✅ `getEvents()` before starting any turn
- ✅ `isRunning()` before starting any turn
- ✅ `getPid()` before starting any turn
- ✅ Multiple `cancel()` calls

**Invalid Model Names (1 test)**
- ✅ Handle invalid model name gracefully
- ✅ Proper error reporting

**Concurrent Sessions (1 test)**
- ✅ Multiple sessions in same sandbox
- ✅ Sessions don't interfere with each other

---

## Running the Tests

### Prerequisites

Set environment variables:
```bash
export DAYTONA_API_KEY="your-daytona-key"
export ANTHROPIC_API_KEY="your-anthropic-key"
```

### Run All Integration Tests

```bash
npm test -- tests/integration/
```

### Run Specific Test Files

```bash
# Background session tests
npm test -- tests/integration/sandbox-background.test.ts

# Error handling tests
npm test -- tests/integration/error-handling.test.ts

# Original provider tests
npm test -- tests/integration/providers.test.ts
```

### Run Specific Test Suites

```bash
# Only session reattachment tests
npm test -- tests/integration/sandbox-background.test.ts -t "session reattachment"

# Only timeout tests
npm test -- tests/integration/error-handling.test.ts -t "timeout handling"
```

---

## Test Statistics

| File | Lines | Tests | Categories |
|------|-------|-------|------------|
| `sandbox-background.test.ts` | ~400 | 18 | 7 |
| `error-handling.test.ts` | ~450 | 23 | 10 |
| **Total New Tests** | **~850** | **41** | **17** |

---

## Key Testing Patterns Used

### 1. **Poll Until End Pattern**
```typescript
async function pollUntilEnd(bg, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  const allEvents = []

  while (Date.now() < deadline) {
    const { events } = await bg.getEvents()
    allEvents.push(...events)
    if (events.some(e => e.type === "end")) break
    await new Promise(r => setTimeout(r, 2000))
  }

  return allEvents
}
```

### 2. **Shared Sandbox for Speed**
Each test file creates a single sandbox in `beforeAll()` and reuses it across all tests, significantly reducing test execution time.

### 3. **Conditional Skip**
Tests are skipped when required API keys are missing:
```typescript
describe.skipIf(!DAYTONA_API_KEY || !ANTHROPIC_API_KEY)("...", () => {
  // tests
})
```

### 4. **Cleanup in Finally Blocks**
Resources are properly cleaned up even when tests fail:
```typescript
try {
  // test code
} finally {
  await sandbox.delete()
}
```

---

## Coverage Improvements

These tests significantly improve coverage in critical areas:

### Before
- ✅ Basic streaming mode
- ✅ Basic background mode
- ✅ Simple prompts
- ❌ Session reattachment
- ❌ Multiple turns
- ❌ Cancellation
- ❌ Crash detection
- ❌ Error scenarios
- ❌ Edge cases

### After
- ✅ Basic streaming mode
- ✅ Basic background mode
- ✅ Simple prompts
- ✅ **Session reattachment** ← NEW
- ✅ **Multiple turns** ← NEW
- ✅ **Cancellation** ← NEW
- ✅ **Crash detection** ← NEW
- ✅ **Error scenarios** ← NEW
- ✅ **Edge cases** ← NEW

---

## Future Test Additions (Not Included)

Additional tests that could be added later (lower priority):

- **System prompt tests** - Verify system prompts work across providers
- **Model selection tests** - Test different model parameters
- **Session persistence tests** - Test local session file management
- **Tool event tests** - Detailed testing of tool execution
- **Multi-provider comparison** - Same task across all providers
- **Long-running task tests** - Tasks >30 seconds
- **Unit tests** - Factory, session utils, sandbox adapter

---

## Notes

- All tests use Claude provider with Anthropic API key
- Tests have generous timeouts (60-180 seconds) to handle real API calls
- Background sessions are tested more extensively than streaming mode
- Error tests verify graceful degradation, not perfect recovery
- Tests are designed to be run in CI/CD with proper credentials
