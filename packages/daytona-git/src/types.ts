/**
 * Type definitions for @upstream/daytona-git
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

  push(path: string, token?: string): Promise<void>
}
