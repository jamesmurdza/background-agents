/**
 * Git command implementations
 *
 * Each function executes git commands in the sandbox via sandbox.process.executeCommand().
 * Credentials are passed via environment variables to avoid exposure in process list.
 */

import type { SandboxProcess, GitStatus } from "./types"
import { withAuth } from "./auth"
import { createGitError } from "./errors"
import { parseGitStatus } from "./parsers"

/**
 * Escape a shell argument to prevent injection
 */
function esc(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Execute a command in the sandbox and throw on failure
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
 * Clone a repository
 */
export async function clone(
  process: SandboxProcess,
  url: string,
  path: string,
  branch?: string,
  commitId?: string,
  token?: string
): Promise<void> {
  const branchFlag = branch ? `-b ${esc(branch)}` : ""
  const cloneCmd = `clone --single-branch ${branchFlag} ${esc(url)} ${esc(path)} 2>&1`

  if (token) {
    await exec(process, withAuth(token, cloneCmd))
  } else {
    await exec(process, `git ${cloneCmd}`)
  }

  if (commitId) {
    await exec(process, `cd ${esc(path)} && git checkout ${esc(commitId)} 2>&1`)
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
  await exec(process, `cd ${esc(path)} && git branch ${esc(branchName)} 2>&1`)
}

/**
 * Checkout/switch to a branch
 */
export async function checkoutBranch(
  process: SandboxProcess,
  path: string,
  branchName: string
): Promise<void> {
  await exec(process, `cd ${esc(path)} && git checkout ${esc(branchName)} 2>&1`)
}

/**
 * Get repository status
 */
export async function status(
  process: SandboxProcess,
  path: string
): Promise<GitStatus> {
  const porcelainOutput = await exec(
    process,
    `cd ${esc(path)} && git status --porcelain -b 2>&1`
  )

  const aheadBehindOutput = await exec(
    process,
    `cd ${esc(path)} && git rev-list --left-right --count @{upstream}...HEAD 2>/dev/null || echo "0 0"`,
    true
  )

  return parseGitStatus(porcelainOutput, aheadBehindOutput)
}

/**
 * Fetch from remote
 */
export async function fetch(
  process: SandboxProcess,
  path: string,
  token?: string,
  refspec?: string
): Promise<void> {
  const ref = refspec ?? ""
  const fetchCmd = `fetch origin ${ref} 2>&1`
  if (token) {
    await exec(process, `cd ${esc(path)} && ${withAuth(token, fetchCmd)}`)
  } else {
    await exec(process, `cd ${esc(path)} && git ${fetchCmd}`)
  }
}

/**
 * Pull changes from remote
 */
export async function pull(
  process: SandboxProcess,
  path: string,
  token?: string
): Promise<void> {
  const pullCmd = `pull 2>&1`
  if (token) {
    await exec(process, `cd ${esc(path)} && ${withAuth(token, pullCmd)}`)
  } else {
    await exec(process, `cd ${esc(path)} && git ${pullCmd}`)
  }
}

/**
 * Push changes to remote
 */
export async function push(
  process: SandboxProcess,
  path: string,
  token?: string
): Promise<void> {
  const pushCmd = `push -u origin HEAD 2>&1`
  if (token) {
    await exec(process, `cd ${esc(path)} && ${withAuth(token, pushCmd)}`)
  } else {
    await exec(process, `cd ${esc(path)} && git ${pushCmd}`)
  }
}
