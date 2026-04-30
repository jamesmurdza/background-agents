/**
 * Git error types for @upstream/daytona-git
 */

/**
 * Base error for git operations
 */
export class GitError extends Error {
  constructor(
    message: string,
    public readonly command: string,
    public readonly exitCode: number,
    public readonly output: string
  ) {
    super(message)
    this.name = "GitError"
  }
}

/**
 * Authentication failed (invalid token, expired, no access)
 */
export class GitAuthError extends GitError {
  constructor(command: string, output: string) {
    super("Git authentication failed", command, 128, output)
    this.name = "GitAuthError"
  }
}

/**
 * Repository not found or no access
 */
export class GitNotFoundError extends GitError {
  constructor(command: string, output: string) {
    super("Repository not found", command, 128, output)
    this.name = "GitNotFoundError"
  }
}

/**
 * Merge/rebase conflict
 */
export class GitConflictError extends GitError {
  constructor(
    command: string,
    output: string,
    public readonly conflictedFiles: string[]
  ) {
    super("Git conflict", command, 1, output)
    this.name = "GitConflictError"
  }
}

/**
 * Check if output indicates an auth error
 */
export function isAuthError(output: string): boolean {
  const lower = output.toLowerCase()
  return (
    lower.includes("authentication failed") ||
    lower.includes("could not read username") ||
    lower.includes("invalid credentials") ||
    lower.includes("401") ||
    lower.includes("403")
  )
}

/**
 * Check if output indicates repo not found
 */
export function isNotFoundError(output: string): boolean {
  const lower = output.toLowerCase()
  return (
    lower.includes("repository not found") ||
    lower.includes("does not exist") ||
    lower.includes("404")
  )
}

/**
 * Create appropriate error from git command failure
 */
export function createGitError(
  command: string,
  exitCode: number,
  output: string
): GitError {
  if (isAuthError(output)) {
    return new GitAuthError(command, output)
  }
  if (isNotFoundError(output)) {
    return new GitNotFoundError(command, output)
  }
  return new GitError(`Git command failed: ${output}`, command, exitCode, output)
}
