/**
 * @upstream/daytona-git
 *
 * Git operations for Daytona sandboxes via sandbox.process.executeCommand().
 * Credentials are passed via -c flags and never stored in the sandbox.
 *
 * @example
 * ```typescript
 * import { createSandboxGit } from "@upstream/daytona-git"
 *
 * const git = createSandboxGit(sandbox)
 *
 * await git.clone(url, path, "main", undefined, token)
 * await git.createBranch(path, "feature/new-branch")
 * await git.push(path, token)
 * ```
 */

import type { SandboxLike, SandboxGit, GitStatus } from "./types"
import * as commands from "./commands"

// Types
export type {
  SandboxGit,
  SandboxLike,
  SandboxProcess,
  GitStatus,
  FileStatus,
  FileStatusType,
  GitCommitResponse,
  ExecuteResult,
} from "./types"

// Errors
export {
  GitError,
  GitAuthError,
  GitNotFoundError,
  GitConflictError,
  isAuthError,
  isNotFoundError,
  createGitError,
} from "./errors"

// Auth
export { withAuth } from "./auth"

// Parsers
export {
  parseGitStatus,
  parseAheadBehind,
  parseCommitSha,
  parseBranchList,
} from "./parsers"

/**
 * Create a SandboxGit instance from a Daytona sandbox
 */
export function createSandboxGit(sandbox: SandboxLike): SandboxGit {
  const { process } = sandbox

  return {
    clone: (url, path, branch?, commitId?, token?) =>
      commands.clone(process, url, path, branch, commitId, token),

    createBranch: (path, branchName) =>
      commands.createBranch(process, path, branchName),

    checkoutBranch: (path, branchName) =>
      commands.checkoutBranch(process, path, branchName),

    status: (path) => commands.status(process, path),

    pull: (path, token?) => commands.pull(process, path, token),

    push: (path, token?) => commands.push(process, path, token),
  }
}

/**
 * Direct access to git commands (for advanced usage)
 */
export const gitCommands = commands
