/**
 * Type definitions for @anthropic/daytona-git
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

// =============================================================================
// Sandbox Process Interface
// =============================================================================

/**
 * Result of executing a command in the sandbox
 */
export interface ExecuteResult {
  result: string
  exitCode: number
}

/**
 * Interface for sandbox process execution.
 * Compatible with Daytona SDK's sandbox.process
 */
export interface SandboxProcess {
  executeCommand(command: string): Promise<ExecuteResult>
}

/**
 * Minimal sandbox interface required by daytona-git.
 * Only needs process.executeCommand - no dependency on git toolbox.
 */
export interface SandboxLike {
  process: SandboxProcess
}

// =============================================================================
// SandboxGit Interface
// =============================================================================

/**
 * Git operations interface - API compatible with Daytona SDK's sandbox.git
 */
export interface SandboxGit {
  /**
   * Clone a repository into the specified path
   *
   * @param url - Repository URL (https://github.com/owner/repo.git)
   * @param path - Destination path in sandbox
   * @param branch - Branch to clone (optional, defaults to default branch)
   * @param commitId - Specific commit to checkout after clone (optional)
   * @param username - Git username for auth (e.g., "x-access-token")
   * @param password - Git password/token for auth
   */
  clone(
    url: string,
    path: string,
    branch?: string,
    commitId?: string,
    username?: string,
    password?: string
  ): Promise<void>

  /**
   * Create a new branch at the current HEAD
   *
   * @param path - Repository path
   * @param branchName - Name for the new branch
   */
  createBranch(path: string, branchName: string): Promise<void>

  /**
   * Checkout/switch to a branch
   *
   * @param path - Repository path
   * @param branchName - Branch to checkout
   */
  checkoutBranch(path: string, branchName: string): Promise<void>

  /**
   * Get repository status
   *
   * @param path - Repository path
   * @returns Current branch, ahead/behind counts, and file statuses
   */
  status(path: string): Promise<GitStatus>

  /**
   * Pull changes from remote
   *
   * @param path - Repository path
   * @param username - Git username for auth (e.g., "x-access-token")
   * @param password - Git password/token for auth
   */
  pull(path: string, username?: string, password?: string): Promise<void>

  /**
   * Push changes to remote
   *
   * @param path - Repository path
   * @param username - Git username for auth (e.g., "x-access-token")
   * @param password - Git password/token for auth
   */
  push(path: string, username?: string, password?: string): Promise<void>
}
