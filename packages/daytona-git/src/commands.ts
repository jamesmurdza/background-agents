/**
 * Git command implementations
 *
 * Each function executes git commands in the sandbox via sandbox.process.executeCommand().
 * Credentials are passed ephemerally and never stored in the sandbox.
 */

import type { SandboxProcess, GitStatus } from "./types"
import { createAuthUrl, stripCredentials, buildAuthFlags } from "./auth"
import { createGitError } from "./errors"
import { parseGitStatus } from "./parsers"

/**
 * Helper to execute a command in the sandbox and throw on failure
 */
async function exec(
  process: SandboxProcess,
  command: string,
  allowFailure = false
): Promise<string> {
  const result = await process.executeCommand(command)
  if (result.exitCode !== 0 && !allowFailure) {
    throw createGitError(command, result.exitCode, result.result)
  }
  return result.result
}

/**
 * Escape a shell argument to prevent injection
 */
function escapeShellArg(arg: string): string {
  // Use single quotes and escape any single quotes in the string
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Clone a repository into the sandbox
 */
export async function clone(
  process: SandboxProcess,
  url: string,
  path: string,
  branch?: string,
  commitId?: string,
  username?: string,
  password?: string
): Promise<void> {
  // Build clone URL (with auth if provided)
  const cloneUrl =
    username && password ? createAuthUrl(url, username, password) : url

  // Build clone command
  let cmd = `git clone --single-branch`
  if (branch) {
    cmd += ` -b ${escapeShellArg(branch)}`
  }
  cmd += ` ${escapeShellArg(cloneUrl)} ${escapeShellArg(path)} 2>&1`

  await exec(process, cmd)

  // If commitId specified, checkout that specific commit
  if (commitId) {
    await exec(
      process,
      `cd ${escapeShellArg(path)} && git checkout ${escapeShellArg(commitId)} 2>&1`
    )
  }

  // If we used auth, update remote to strip credentials from .git/config
  if (username && password) {
    const cleanUrl = stripCredentials(cloneUrl)
    await exec(
      process,
      `cd ${escapeShellArg(path)} && git remote set-url origin ${escapeShellArg(cleanUrl)} 2>&1`
    )
  }
}

/**
 * Create a new branch at current HEAD
 */
export async function createBranch(
  process: SandboxProcess,
  path: string,
  branchName: string
): Promise<void> {
  await exec(
    process,
    `cd ${escapeShellArg(path)} && git branch ${escapeShellArg(branchName)} 2>&1`
  )
}

/**
 * Checkout/switch to a branch
 */
export async function checkoutBranch(
  process: SandboxProcess,
  path: string,
  branchName: string
): Promise<void> {
  await exec(
    process,
    `cd ${escapeShellArg(path)} && git checkout ${escapeShellArg(branchName)} 2>&1`
  )
}

/**
 * Get repository status
 */
export async function status(
  process: SandboxProcess,
  path: string
): Promise<GitStatus> {
  // Get porcelain status with branch info
  const porcelainOutput = await exec(
    process,
    `cd ${escapeShellArg(path)} && git status --porcelain -b 2>&1`
  )

  // Get ahead/behind counts (may fail if no upstream)
  const aheadBehindOutput = await exec(
    process,
    `cd ${escapeShellArg(path)} && git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0 0"`,
    true // Allow failure
  )

  return parseGitStatus(porcelainOutput, aheadBehindOutput)
}

/**
 * Pull changes from remote with authentication
 *
 * Uses git -c flag to pass credentials for a single command invocation.
 * No state to manage, no cleanup needed.
 */
export async function pull(
  process: SandboxProcess,
  path: string,
  username?: string,
  password?: string
): Promise<void> {
  const authFlags = password ? buildAuthFlags(password) : ""
  await exec(
    process,
    `cd ${escapeShellArg(path)} && git ${authFlags} pull 2>&1`
  )
}

/**
 * Push changes to remote with authentication
 *
 * Uses git -c flag to pass credentials for a single command invocation.
 * No state to manage, no cleanup needed.
 */
export async function push(
  process: SandboxProcess,
  path: string,
  username?: string,
  password?: string
): Promise<void> {
  const authFlags = password ? buildAuthFlags(password) : ""
  await exec(
    process,
    `cd ${escapeShellArg(path)} && git ${authFlags} push -u origin HEAD 2>&1`
  )
}
