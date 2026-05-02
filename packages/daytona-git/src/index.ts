/**
 * @upstream/daytona-git
 *
 * Git operations for Daytona sandboxes that execute commands directly
 * via sandbox.process.executeCommand() instead of the Daytona Git Toolbox.
 *
 * Key principle: Credentials are passed ephemerally per-operation
 * and never stored in the sandbox.
 *
 * @example
 * ```typescript
 * import { createSandboxGit } from "@upstream/daytona-git"
 *
 * // Create git interface from any Daytona sandbox
 * const git = createSandboxGit(sandbox)
 *
 * // Same API as Daytona SDK's sandbox.git
 * await git.clone(url, path, branch, undefined, "x-access-token", token)
 * await git.createBranch(path, "feature/new-branch")
 * await git.checkoutBranch(path, "feature/new-branch")
 * await git.push(path, "x-access-token", token)
 * ```
 */

import type { SandboxLike, SandboxGit, GitStatus } from "./types"
import * as commands from "./commands"

// =============================================================================
// Re-exports
// =============================================================================

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

// Auth utilities
export { createAuthUrl, stripCredentials, hasCredentials, buildAuthFlags } from "./auth"

// Parsers (useful for testing or custom implementations)
export {
  parseGitStatus,
  parseAheadBehind,
  parseCommitSha,
  parseBranchList,
} from "./parsers"

// =============================================================================
// Main API
// =============================================================================

/**
 * Create a SandboxGit instance from a Daytona sandbox
 *
 * This is the main entry point. The returned object has the same API
 * as Daytona SDK's sandbox.git, making migration straightforward.
 *
 * @param sandbox - A Daytona sandbox instance (or any object with process.executeCommand)
 * @returns SandboxGit interface for git operations
 *
 * @example
 * ```typescript
 * import { Daytona } from "@daytonaio/sdk"
 * import { createSandboxGit } from "@upstream/daytona-git"
 *
 * const daytona = new Daytona({ apiKey })
 * const sandbox = await daytona.get(sandboxId)
 *
 * // Create git interface - uses sandbox.process.executeCommand internally
 * const git = createSandboxGit(sandbox)
 *
 * // Clone with auth (credentials are ephemeral, not stored)
 * await git.clone(
 *   "https://github.com/owner/repo.git",
 *   "/home/daytona/project",
 *   "main",
 *   undefined,
 *   "x-access-token",
 *   githubToken
 * )
 *
 * // Create and checkout a branch
 * await git.createBranch("/home/daytona/project", "feature/my-feature")
 * await git.checkoutBranch("/home/daytona/project", "feature/my-feature")
 *
 * // Get status
 * const status = await git.status("/home/daytona/project")
 * console.log(`On branch: ${status.currentBranch}`)
 *
 * // Push changes (credentials used only for this operation)
 * await git.push("/home/daytona/project", "x-access-token", githubToken)
 * ```
 */
export function createSandboxGit(sandbox: SandboxLike): SandboxGit {
  const { process } = sandbox

  return {
    clone: (
      url: string,
      path: string,
      branch?: string,
      commitId?: string,
      username?: string,
      password?: string
    ): Promise<void> => {
      return commands.clone(process, url, path, branch, commitId, username, password)
    },

    createBranch: (path: string, branchName: string): Promise<void> => {
      return commands.createBranch(process, path, branchName)
    },

    checkoutBranch: (path: string, branchName: string): Promise<void> => {
      return commands.checkoutBranch(process, path, branchName)
    },

    status: (path: string): Promise<GitStatus> => {
      return commands.status(process, path)
    },

    pull: (
      path: string,
      username?: string,
      password?: string
    ): Promise<void> => {
      return commands.pull(process, path, username, password)
    },

    push: (
      path: string,
      username?: string,
      password?: string
    ): Promise<void> => {
      return commands.push(process, path, username, password)
    },
  }
}

/**
 * Direct access to git command implementations
 *
 * Useful when you want to call commands directly without creating
 * a SandboxGit instance, or for testing individual commands.
 *
 * @example
 * ```typescript
 * import { gitCommands } from "@upstream/daytona-git"
 *
 * // Call commands directly with sandbox.process
 * await gitCommands.clone(sandbox.process, url, path, branch)
 * await gitCommands.push(sandbox.process, path, "x-access-token", token)
 * ```
 */
export const gitCommands = commands
