# @upstream/daytona-git

Git operations for Daytona sandboxes via `sandbox.process.executeCommand()`.

## Why?

- **No toolbox dependency** - Works with any Daytona sandbox
- **Credentials never stored** - Passed via git `-c` flags per-operation
- **Simple API** - Just pass the token, no username needed

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@upstream/daytona-git"

const daytona = new Daytona({ apiKey })
const sandbox = await daytona.get(sandboxId)
const git = createSandboxGit(sandbox)

// Clone
await git.clone("https://github.com/owner/repo.git", path, "main", undefined, token)

// Branch operations
await git.createBranch(path, "feature/new-feature")
await git.checkoutBranch(path, "feature/new-feature")

// Status
const status = await git.status(path)
console.log(`On branch: ${status.currentBranch}`)

// Remote operations
await git.fetch(path, token)
await git.fetch(path, token, "--prune")     // with refspec
await git.fetch(path, token, "main")        // specific branch
await git.pull(path, token)
await git.push(path, token)
```

## API

| Method | Description |
|--------|-------------|
| `clone(url, path, branch?, commitId?, token?)` | Clone a repository |
| `createBranch(path, branchName)` | Create a new branch |
| `checkoutBranch(path, branchName)` | Switch to a branch |
| `status(path)` | Get repository status |
| `fetch(path, token?, refspec?)` | Fetch from remote |
| `pull(path, token?)` | Pull from remote |
| `push(path, token?)` | Push to remote |

## How Credentials Work

Credentials are passed via git's `-c` flag:

```bash
git -c http.extraHeader='Authorization: Basic <base64>' push
```

This means:
- No config files modified
- No cleanup needed
- Credential exists only for that command
