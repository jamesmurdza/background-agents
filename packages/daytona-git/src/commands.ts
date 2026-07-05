/**
 * Git command implementations
 *
 * Each function executes git commands in the sandbox via sandbox.process.executeCommand().
 * Credentials are passed inline via git's `-c http.extraHeader` flag (see auth.ts) and are
 * never written to git config or disk. Note: because the header is part of the command
 * string, the base64-encoded credential is briefly visible in the sandbox process list while
 * the command runs.
 */

import type { SandboxProcess, GitStatus, PushResult } from "./types"
import { withAuth } from "./auth"
import { createGitError } from "./errors"
import { parseGitStatus } from "./parsers"
import { shellEscape as esc } from "./shell"

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
 * Clone a repository.
 *
 * IMPORTANT: when a token is provided, `withAuth` prepends `git -c http.extraHeader=…`
 * BEFORE the `clone` subcommand. This placement must be preserved — `git clone -c <k>=<v>`
 * (flag after `clone`) is clone's own `--config` option, which persists the value into the
 * new repo's `.git/config` and would leak the credential to disk. Top-level `git -c` is
 * process-scoped only.
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
 * Fetch a specific branch and ensure its remote tracking ref is created.
 * This is needed for single-branch clones where `git fetch origin <branch>`
 * alone does not create `origin/<branch>`.
 */
export async function fetchBranch(
  process: SandboxProcess,
  path: string,
  branch: string,
  token?: string
): Promise<void> {
  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  const fetchCmd = `fetch origin ${refspec} 2>&1`
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
 * Parse the output of `git push --porcelain` into a structured result.
 *
 * Porcelain emits one tab-separated status line per ref, whose first character
 * is a flag:
 *   ' ' fast-forward · '+' forced update · '*' new ref · '=' up to date ·
 *   '!' rejected · '-' deleted
 * The trailing summary field carries the "<old>..<new>" range (or "...<new>"
 * for forced updates), or "[new branch]" / "[up to date]".
 */
export function parsePushOutput(output: string): PushResult {
  let updated = false
  let newBranch = false
  let range: string | null = null

  for (const line of output.split("\n")) {
    // Ref status lines are tab-separated; skip "To <url>", "Done", remote
    // messages, and blanks.
    if (!line.includes("\t") || line.startsWith("To ")) continue
    const flag = line[0]
    if (flag !== " " && flag !== "+" && flag !== "*") continue

    updated = true
    const summary = line.split("\t").pop()?.trim() ?? ""
    if (flag === "*" || /\[new branch\]/.test(summary)) newBranch = true
    const m = summary.match(/([0-9a-f]{4,40}\.\.\.?[0-9a-f]{4,40})/)
    if (m) range = m[1]
  }

  return { output, updated, newBranch, range }
}

/**
 * Push changes to remote.
 *
 * Uses `--porcelain` so the result can be parsed to tell whether the remote
 * ref actually advanced (vs. "Everything up-to-date").
 *
 * @param process - The sandbox process to execute commands
 * @param path - The repository path
 * @param token - Optional GitHub token for authentication
 * @param options - Optional push options
 * @param options.noVerify - When true, skip pre-push hooks (default: true for backward compatibility)
 */
export async function push(
  process: SandboxProcess,
  path: string,
  token?: string,
  options?: { noVerify?: boolean }
): Promise<PushResult> {
  // Default to --no-verify for backward compatibility
  const noVerify = options?.noVerify ?? true
  const noVerifyFlag = noVerify ? " --no-verify" : ""
  const pushCmd = `push --porcelain -u origin HEAD${noVerifyFlag} 2>&1`
  const output = token
    ? await exec(process, `cd ${esc(path)} && ${withAuth(token, pushCmd)}`)
    : await exec(process, `cd ${esc(path)} && git ${pushCmd}`)
  return parsePushOutput(output)
}
