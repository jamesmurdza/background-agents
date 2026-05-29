# @background-agents/daytona-git

Git operations for Daytona sandboxes via `sandbox.process.executeCommand()`.

## Why?

- **No toolbox dependency** - Works with any Daytona sandbox
- **Credentials never stored** - Passed via git `-c` flags per-operation
- **Simple API** - Just pass the token, no username needed

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSandboxGit } from "@background-agents/daytona-git"

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
await git.fetch(path, token)                // fetch from origin
await git.fetch(path, token, "main")        // fetch a specific refspec
await git.fetchBranch(path, "main", token)  // fetch a branch + create remote tracking ref
await git.pull(path, token)
await git.push(path, token)                 // defaults to --no-verify
await git.push(path, token, { noVerify: false })  // run pre-push hooks
```

## API

| Method | Description |
|--------|-------------|
| `clone(url, path, branch?, commitId?, token?)` | Clone a repository |
| `createBranch(path, branchName)` | Create a new branch |
| `checkoutBranch(path, branchName)` | Switch to a branch |
| `status(path)` | Get repository status |
| `fetch(path, token?, refspec?)` | Fetch from remote |
| `fetchBranch(path, branch, token?)` | Fetch a specific branch |
| `pull(path, token?)` | Pull from remote |
| `push(path, token?, options?)` | Push to remote. `options.noVerify` skips pre-push hooks (default: `true`) |

## How Credentials Work

Credentials are passed inline via git's `-c` flag. The token is sent as HTTP Basic
auth with a fixed username (`x-access-token`), so callers only need to supply the token:

```bash
git -c http.extraHeader='Authorization: Basic <base64>' push
# where <base64> = base64("x-access-token:<token>")
```

This means:
- No git config files are modified, and nothing is written to disk
- No cleanup needed
- The credential is applied only for that single command

**Caveat:** because the header is part of the command string (not an environment
variable), the `<base64>` value is briefly visible in the sandbox process list while
the command runs. Base64 is encoding, not encryption, so it can be trivially decoded —
treat the sandbox as a trusted environment.

**Note on `clone`:** the `-c http.extraHeader=…` flag must be placed *before* the
`clone` subcommand (as it is here). The seemingly equivalent `git clone -c <key>=<value> …`
form is actually `clone`'s own `--config` option, which **persists** the value into the
new repo's `.git/config` — a credential leak. Placing `-c` before `clone` makes it the
top-level `git` flag, which is process-scoped and never written to the new repo. This
caveat is unique to `clone` (and `submodule`); other subcommands don't accept a
persisting `-c` form.
