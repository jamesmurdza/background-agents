# @upstream/daytona-git

Git operations for Daytona sandboxes that execute commands directly via `sandbox.process.executeCommand()` instead of the Daytona Git Toolbox.

## Why?

- **No toolbox dependency** - Works with any Daytona sandbox
- **Credentials are ephemeral** - Never stored in the sandbox, only used per-operation
- **Drop-in replacement** - Same API as Daytona SDK's `sandbox.git`
- **Full control** - See exactly what git commands are being run

## Installation

```bash
npm install @upstream/daytona-git
```

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@upstream/daytona-git"

const daytona = new Daytona({ apiKey })
const sandbox = await daytona.get(sandboxId)

// Create git interface
const git = createSandboxGit(sandbox)

// Clone with authentication
await git.clone(
  "https://github.com/owner/repo.git",
  "/home/daytona/project",
  "main",
  undefined,
  "x-access-token",  // GitHub username for token auth
  githubToken         // The actual token
)

// Create and switch branches
await git.createBranch("/home/daytona/project", "feature/new-feature")
await git.checkoutBranch("/home/daytona/project", "feature/new-feature")

// Check status
const status = await git.status("/home/daytona/project")
console.log(`On branch: ${status.currentBranch}`)
console.log(`Ahead: ${status.ahead}, Behind: ${status.behind}`)

// Pull and push with auth
await git.pull("/home/daytona/project", "x-access-token", githubToken)
await git.push("/home/daytona/project", "x-access-token", githubToken)
```

## API

### `createSandboxGit(sandbox)`

Creates a `SandboxGit` interface from a Daytona sandbox.

```typescript
const git = createSandboxGit(sandbox)
```

### `SandboxGit` Methods

| Method | Description |
|--------|-------------|
| `clone(url, path, branch?, commitId?, username?, password?)` | Clone a repository |
| `createBranch(path, branchName)` | Create a new branch |
| `checkoutBranch(path, branchName)` | Switch to a branch |
| `status(path)` | Get repository status |
| `pull(path, username?, password?)` | Pull from remote |
| `push(path, username?, password?)` | Push to remote |

### Error Handling

```typescript
import {
  createSandboxGit,
  GitError,
  GitAuthError,
  GitNotFoundError
} from "@anthropic/daytona-git"

try {
  await git.push(path, "x-access-token", token)
} catch (error) {
  if (error instanceof GitAuthError) {
    console.error("Token expired or invalid")
  } else if (error instanceof GitNotFoundError) {
    console.error("Repository not found")
  } else if (error instanceof GitError) {
    console.error(`Git failed: ${error.output}`)
  }
}
```

## How Credentials Work

Credentials are **never persisted** in the sandbox. For operations requiring auth (`clone`, `pull`, `push`):

1. Get the current remote URL
2. Temporarily set an authenticated URL (`https://user:token@github.com/...`)
3. Run the git command
4. Restore the original URL

This ensures credentials exist only in memory during the operation.

## Migration from Daytona SDK

Replace:
```typescript
await sandbox.git.clone(url, path, branch, undefined, "x-access-token", token)
await sandbox.git.push(path, "x-access-token", token)
```

With:
```typescript
import { createSandboxGit } from "@upstream/daytona-git"

const git = createSandboxGit(sandbox)
await git.clone(url, path, branch, undefined, "x-access-token", token)
await git.push(path, "x-access-token", token)
```

Same API, same arguments.
