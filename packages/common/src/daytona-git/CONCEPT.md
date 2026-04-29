# daytona-git Package Concept

## Overview

A drop-in replacement for the Daytona SDK's `sandbox.git.*` methods that executes git commands directly via `sandbox.process.executeCommand()` instead of relying on the Daytona Git Toolbox API.

**Key Principle:** Credentials are passed ephemerally per-operation and never stored in the sandbox.

---

## Why Replace the Daytona Git Toolbox?

1. **Independence** - No dependency on Daytona's toolbox implementation
2. **Transparency** - Full control over git commands being executed
3. **Flexibility** - Easy to extend with custom git operations
4. **Debugging** - Direct visibility into git command outputs

---

## API Design

### Interface: `SandboxGit`

```typescript
interface SandboxGit {
  clone(
    url: string,
    path: string,
    branch?: string,
    commitId?: string,
    username?: string,
    password?: string
  ): Promise<void>

  createBranch(path: string, branchName: string): Promise<void>

  checkoutBranch(path: string, branchName: string): Promise<void>

  status(path: string): Promise<GitStatus>

  pull(path: string, username?: string, password?: string): Promise<void>

  push(path: string, username?: string, password?: string): Promise<void>
}
```

### Type: `GitStatus`

```typescript
interface GitStatus {
  currentBranch: string
  ahead: number
  behind: number
  isPublished: boolean
  fileStatus: FileStatus[]
}

interface FileStatus {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'
  staged: boolean
}
```

---

## Implementation Strategy

### Factory Function

```typescript
import type { Sandbox } from "@daytonaio/sdk"

function createSandboxGit(sandbox: Sandbox): SandboxGit {
  const exec = (cmd: string) => sandbox.process.executeCommand(cmd)

  return {
    clone: async (url, path, branch, commitId, username, password) => { ... },
    createBranch: async (path, branchName) => { ... },
    checkoutBranch: async (path, branchName) => { ... },
    status: async (path) => { ... },
    pull: async (path, username, password) => { ... },
    push: async (path, username, password) => { ... },
  }
}
```

### Credential Handling

For operations requiring authentication (`clone`, `pull`, `push`), credentials are injected into the remote URL temporarily:

```typescript
// Pattern: https://x-access-token:{token}@github.com/owner/repo.git
function createAuthUrl(url: string, username: string, password: string): string {
  return url.replace('https://', `https://${username}:${password}@`)
}
```

**Security:** Credentials never persist in the sandbox:
- For `clone`: Use authenticated URL directly
- For `push`/`pull`: Temporarily set auth URL, execute, restore original URL

---

## Command Mappings

### `clone(url, path, branch?, commitId?, username?, password?)`

```bash
# With auth:
git clone --single-branch -b {branch} https://x-access-token:{token}@github.com/owner/repo.git {path}

# With specific commit:
git clone https://... {path}
cd {path} && git checkout {commitId}
```

### `createBranch(path, branchName)`

```bash
cd {path} && git branch {branchName}
```

### `checkoutBranch(path, branchName)`

```bash
cd {path} && git checkout {branchName}
```

### `status(path)`

```bash
cd {path} && git status --porcelain -b
cd {path} && git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0 0"
```

**Parsing:**
- Line 1: `## branch...origin/branch [ahead N, behind M]`
- Remaining lines: File statuses (M, A, D, R, ??)

### `pull(path, username?, password?)`

```bash
# Get original URL
cd {path} && git remote get-url origin

# Set auth URL
cd {path} && git remote set-url origin 'https://x-access-token:{token}@...'

# Pull
cd {path} && git pull

# Restore original URL
cd {path} && git remote set-url origin '{originalUrl}'
```

### `push(path, username?, password?)`

```bash
# Same pattern as pull
cd {path} && git remote get-url origin
cd {path} && git remote set-url origin 'https://x-access-token:{token}@...'
cd {path} && git push -u origin HEAD
cd {path} && git remote set-url origin '{originalUrl}'
```

---

## File Structure

```
packages/common/src/daytona-git/
├── index.ts           # Main export: createSandboxGit()
├── types.ts           # GitStatus, FileStatus, SandboxGit interface
├── commands.ts        # Individual git command implementations
├── auth.ts            # URL authentication utilities
├── parsers.ts         # Parse git command output (status, etc.)
└── errors.ts          # GitError, GitConflictError, etc.
```

---

## Usage in Web Package

### Before (Daytona SDK):

```typescript
await sandbox.git.clone(url, path, branch, undefined, "x-access-token", token)
await sandbox.git.createBranch(path, newBranch)
await sandbox.git.checkoutBranch(path, newBranch)
await sandbox.git.push(path, "x-access-token", token)
```

### After (daytona-git):

```typescript
import { createSandboxGit } from "@upstream/common/daytona-git"

const git = createSandboxGit(sandbox)

await git.clone(url, path, branch, undefined, "x-access-token", token)
await git.createBranch(path, newBranch)
await git.checkoutBranch(path, newBranch)
await git.push(path, "x-access-token", token)
```

**Drop-in compatible API** - same method signatures as Daytona SDK.

---

## Error Handling

```typescript
class GitError extends Error {
  constructor(
    message: string,
    public command: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message)
    this.name = 'GitError'
  }
}

class GitAuthError extends GitError {
  constructor(command: string, stderr: string) {
    super('Authentication failed', command, 128, stderr)
    this.name = 'GitAuthError'
  }
}

class GitConflictError extends GitError {
  constructor(
    command: string,
    stderr: string,
    public conflictedFiles: string[]
  ) {
    super('Merge conflict', command, 1, stderr)
    this.name = 'GitConflictError'
  }
}
```

---

## Additional Operations (Future)

These could be added later to extend beyond Daytona's toolbox:

```typescript
interface SandboxGitExtended extends SandboxGit {
  // Already implemented via process.executeCommand in web:
  fetch(path: string, username?: string, password?: string, refspec?: string): Promise<void>

  // New operations:
  add(path: string, files: string[]): Promise<void>
  commit(path: string, message: string, author: string, email: string): Promise<GitCommitResponse>
  branches(path: string): Promise<string[]>
  log(path: string, limit?: number): Promise<GitLogEntry[]>
  diff(path: string, ref?: string): Promise<string>
  merge(path: string, branch: string): Promise<MergeResult>
  rebase(path: string, onto: string): Promise<RebaseResult>
  stash(path: string): Promise<void>
  stashPop(path: string): Promise<void>
}
```

---

## Migration Path

1. **Phase 1:** Create `daytona-git` in common package with the 6 core operations
2. **Phase 2:** Update `lib/sandbox.ts` to use `createSandboxGit(sandbox)` instead of `sandbox.git`
3. **Phase 3:** Update `api/sandbox/git/route.ts` to use the new package
4. **Phase 4:** Update `api/git/push/route.ts` and `api/agent/stream/route.ts`
5. **Phase 5:** Remove Daytona SDK git dependency (if applicable)

---

## Testing Strategy

```typescript
// Mock sandbox.process.executeCommand for unit tests
const mockSandbox = {
  process: {
    executeCommand: jest.fn()
  }
}

// Test each operation with expected command and parse results
test('status parses branch and file info', async () => {
  mockSandbox.process.executeCommand
    .mockResolvedValueOnce({
      result: '## main...origin/main [ahead 2]\nM  src/file.ts\n?? new.ts',
      exitCode: 0
    })

  const git = createSandboxGit(mockSandbox)
  const status = await git.status('/repo')

  expect(status.currentBranch).toBe('main')
  expect(status.ahead).toBe(2)
  expect(status.fileStatus).toHaveLength(2)
})
```
