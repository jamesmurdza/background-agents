/**
 * Type definitions for @background-agents/sandbox-git
 */

// =============================================================================
// Git Status Types
// =============================================================================

export type FileStatusType =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"

export interface FileStatus {
  path: string
  status: FileStatusType
  staged: boolean
}

export interface GitStatus {
  currentBranch: string
  ahead: number
  behind: number
  isPublished: boolean
  fileStatus: FileStatus[]
}

export interface GitCommitResponse {
  sha: string
}

/**
 * Result of a `git push`, derived from `--porcelain` output.
 */
export interface PushResult {
  /** Raw push output (porcelain status lines plus any remote messages). */
  output: string
  /** True when the remote ref actually advanced — i.e. something was pushed. */
  updated: boolean
  /** True when the push created a new remote branch. */
  newBranch: boolean
  /** "<old>..<new>" sha range when an existing ref moved, else null. */
  range: string | null
}

// =============================================================================
// Sandbox Process Interface
// =============================================================================

export interface ExecuteResult {
  result: string
  exitCode: number
}

export interface SandboxProcess {
  executeCommand(command: string): Promise<ExecuteResult>
}

export interface SandboxLike {
  process: SandboxProcess
}

// =============================================================================
// SandboxGit Interface
// =============================================================================

export interface SandboxGit {
  clone(
    url: string,
    path: string,
    branch?: string,
    commitId?: string,
    token?: string
  ): Promise<void>

  createBranch(path: string, branchName: string): Promise<void>

  checkoutBranch(path: string, branchName: string): Promise<void>

  status(path: string): Promise<GitStatus>

  fetch(path: string, token?: string, refspec?: string): Promise<void>

  /** Fetch a branch and ensure its remote tracking ref is created */
  fetchBranch(path: string, branch: string, token?: string): Promise<void>

  pull(path: string, token?: string): Promise<void>

  /**
   * Push changes to remote.
   * @param path - The repository path
   * @param token - Optional GitHub token for authentication
   * @param options - Optional push options
   * @param options.noVerify - When true, skip pre-push hooks (default: true)
   * @returns A {@link PushResult} parsed from `git push --porcelain`, so callers
   *   can tell whether the remote actually advanced.
   */
  push(path: string, token?: string, options?: { noVerify?: boolean }): Promise<PushResult>
}
