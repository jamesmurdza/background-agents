/**
 * Sandbox orchestration helpers.
 *
 * Pulled out of the legacy /api/sandbox/* routes so the new
 * /api/chats/[chatId]/messages endpoint can drive sandbox lifecycle
 * directly without duplicating the bring-up sequence.
 */

import type { Daytona, Sandbox } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { createSandboxGit } from "@upstream/daytona-git"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"
import { prisma } from "@/lib/db/prisma"

/**
 * Ensure a sandbox is in the "started" state, handling the race condition
 * where multiple concurrent requests try to start the same sandbox.
 *
 * If the sandbox is already starting (409 Conflict), retries with backoff
 * until the start succeeds or times out.
 */
export async function ensureSandboxStarted(
  sandbox: Sandbox,
  timeoutSeconds = 120
): Promise<void> {
  if (sandbox.state === "started") return

  const maxAttempts = 5
  const baseDelayMs = 500

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await sandbox.start(timeoutSeconds)
      return
    } catch (err: unknown) {
      // Handle race condition: another request is already starting this sandbox
      const isConflict =
        err instanceof Error &&
        ((err as { statusCode?: number }).statusCode === 409 ||
          err.message.includes("state change in progress"))

      if (!isConflict) throw err

      // Last attempt - give up
      if (attempt === maxAttempts - 1) {
        throw new Error(
          `Sandbox failed to start after ${maxAttempts} attempts (state change in progress)`
        )
      }

      // Exponential backoff: 500ms, 1s, 2s, 4s
      const delayMs = baseDelayMs * Math.pow(2, attempt)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}

export interface CreateSandboxOptions {
  daytona: Daytona
  /** "owner/repo" string, or NEW_REPOSITORY for a brand-new local repo. */
  repo: string
  baseBranch: string
  newBranch: string
  /** Required for non-NEW_REPOSITORY repos. Used for clone + push. */
  githubToken?: string
  /** First 8 chars are used in the sandbox name for traceability. */
  userId?: string
  /**
   * If true, attempt to restore an existing branch from remote instead of
   * creating a fresh one. Used when recreating a deleted sandbox.
   */
  restoreExistingBranch?: boolean
}

export interface CreatedSandbox {
  sandbox: Awaited<ReturnType<Daytona["create"]>>
  sandboxId: string
  branch: string
  previewUrlPattern: string | undefined
  /** Always "project" in this repo, but returned so callers can plumb it through. */
  repoName: string
  /**
   * When restoreExistingBranch is true, indicates whether the branch was
   * successfully fetched from remote (true) or created fresh (false).
   */
  branchRestored?: boolean
}

function generateSandboxName(userId?: string): string {
  const uuid = randomUUID().split("-")[0]
  const userIdPrefix = userId ? userId.slice(0, 8) : "anon"
  return `backgrounder-${userIdPrefix}-${uuid}`
}

/**
 * Create a Daytona sandbox and prepare it for an agent run: clone the repo
 * (or git-init for NEW_REPOSITORY), set up author config, create the working
 * branch, and look up the preview URL pattern.
 */
export async function createSandboxForChat(
  options: CreateSandboxOptions
): Promise<CreatedSandbox> {
  const { daytona, repo, baseBranch, newBranch, githubToken, userId, restoreExistingBranch } = options
  const isNewRepo = repo === NEW_REPOSITORY || repo === "__new__"
  const repoName = "project"
  let branchRestored: boolean | undefined

  let owner: string | undefined
  let repoApiName: string | undefined
  if (!isNewRepo) {
    if (!githubToken) {
      throw new Error("githubToken required for non-NEW_REPOSITORY chats")
    }
    const parts = repo.split("/")
    owner = parts[0]
    repoApiName = parts[1]
    if (!owner || !repoApiName) {
      throw new Error("Invalid repo format")
    }
  }

  const sandbox = await daytona.create({
    name: generateSandboxName(userId),
    snapshot: SANDBOX_CONFIG.DEFAULT_SNAPSHOT,
    autoStopInterval: 5,
    autoDeleteInterval: 10080, // 7 days - auto-delete after being stopped for a week
    public: true,
    labels: {
      [SANDBOX_CONFIG.LABEL_KEY]: "true",
      repo: isNewRepo ? NEW_REPOSITORY : `${owner}/${repoApiName}`,
      branch: newBranch,
    },
  })

  await sandbox.process.executeCommand(`mkdir -p ${PATHS.LOGS_DIR}`)

  const repoPath = `${PATHS.SANDBOX_HOME}/${repoName}`

  if (isNewRepo) {
    await sandbox.process.executeCommand(`mkdir -p ${repoPath}`)
    await sandbox.process.executeCommand(`cd ${repoPath} && git init`)
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git config user.email "agent@simplechat.dev" && git config user.name "Simple Chat Agent"`
    )
    await sandbox.process.executeCommand(
      `cd ${repoPath} && echo "# Project" > README.md && git add . && git commit -m "Initial commit"`
    )
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git checkout -b ${newBranch}`
    )
  } else {
    const cloneUrl = `https://github.com/${owner}/${repoApiName}.git`
    const git = createSandboxGit(sandbox)
    await git.clone(cloneUrl, repoPath, baseBranch, undefined, githubToken!)

    let gitName = "Simple Chat Agent"
    let gitEmail = "noreply@example.com"
    try {
      const ghRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      })
      if (ghRes.ok) {
        const ghUser = await ghRes.json()
        gitName = ghUser.name || ghUser.login
        gitEmail = `${ghUser.login}@users.noreply.github.com`
      }
    } catch {
      /* use defaults */
    }
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git config user.email "${gitEmail}" && git config user.name "${gitName}"`
    )

    // Branch setup: either restore existing branch from remote or create new
    if (restoreExistingBranch) {
      try {
        await git.fetchBranch(repoPath, newBranch, githubToken!)
        await git.checkoutBranch(repoPath, newBranch)
        branchRestored = true
      } catch {
        // Branch doesn't exist on remote, create fresh from baseBranch
        await git.createBranch(repoPath, newBranch)
        await git.checkoutBranch(repoPath, newBranch)
        branchRestored = false
      }
    } else {
      await git.createBranch(repoPath, newBranch)
      await git.checkoutBranch(repoPath, newBranch)
    }
  }

  let previewUrlPattern: string | undefined
  try {
    const previewLink = await sandbox.getPreviewLink(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT)
    previewUrlPattern = previewLink.url.replace(
      String(SANDBOX_CONFIG.DEFAULT_PREVIEW_PORT),
      "{port}"
    )
  } catch {
    /* preview URLs not available */
  }

  return {
    sandbox,
    sandboxId: sandbox.id,
    branch: newBranch,
    previewUrlPattern,
    repoName,
    branchRestored,
  }
}

/**
 * Upload files to an existing sandbox under repoPath, resolving filename
 * conflicts with -1, -2, …, -timestamp suffixes. Returns the destination paths.
 */
export async function uploadFilesToSandbox(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string,
  files: File[]
): Promise<string[]> {
  const paths: string[] = []
  for (const file of files) {
    const resolvedName = await resolveFilename(sandbox, repoPath, file.name)
    const destPath = `${repoPath}/${resolvedName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    await sandbox.fs.uploadFile(buffer, destPath)
    paths.push(destPath)
  }
  return paths
}

async function resolveFilename(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string,
  filename: string
): Promise<string> {
  if (!(await fileExists(sandbox, `${repoPath}/${filename}`))) return filename

  const lastDot = filename.lastIndexOf(".")
  const hasExt = lastDot > 0
  const base = hasExt ? filename.slice(0, lastDot) : filename
  const ext = hasExt ? filename.slice(lastDot) : ""

  for (let counter = 1; counter < 100; counter++) {
    const candidate = `${base}-${counter}${ext}`
    if (!(await fileExists(sandbox, `${repoPath}/${candidate}`))) return candidate
  }
  return `${base}-${Date.now()}${ext}`
}

async function fileExists(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  path: string
): Promise<boolean> {
  try {
    const result = await sandbox.process.executeCommand(`test -e "${path}" && echo "exists"`)
    return result.result?.trim() === "exists"
  } catch {
    return false
  }
}

/**
 * Best-effort sandbox deletion used in the failure path of message
 * orchestration. Errors are swallowed because they're already happening
 * inside another error handler.
 */
export async function deleteSandboxQuietly(
  daytona: Daytona,
  sandboxId: string
): Promise<void> {
  try {
    const sandbox = await daytona.get(sandboxId)
    await sandbox.delete()
  } catch (err) {
    console.error("[sandbox] Failed to delete sandbox:", sandboxId, err)
  }
}

/**
 * Install all repo-scoped skills into a sandbox.
 *
 * Called during sandbox creation/restoration to ensure skills are present
 * before the agent starts. Pre-validates each skill via --list to avoid
 * installing stale/renamed skills. Best-effort — individual failures are
 * logged but don't abort the overall sandbox setup.
 */
export async function installSkillsForRepo(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  userId: string,
  repo: string
): Promise<{ installed: number; total: number }> {
  const skills = await prisma.skill.findMany({
    where: { userId, repo },
    orderBy: { createdAt: "asc" },
  })

  if (skills.length === 0) return { installed: 0, total: 0 }

  const repoPath = `${PATHS.SANDBOX_HOME}/project`
  let installed = 0

  // Cache --list results per source repo so we only clone once per repo
  const availableSkillsCache = new Map<string, Set<string> | null>()

  for (const skill of skills) {
    try {
      // fullHandle is "owner/repo/skillId" — extract parts for install command
      // Must use --agent '*' -y for non-interactive sandbox environments
      const parts = skill.fullHandle.split("/")
      const source = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : skill.fullHandle
      const skillId = parts.length >= 3 ? parts.slice(2).join("/") : null

      // Pre-validate: check the skill actually exists in the repo
      if (skillId) {
        if (!availableSkillsCache.has(source)) {
          try {
            const listCmd = await sandbox.process.executeCommand(
              `cd ${repoPath} && npx -y skills add ${source} --list 2>&1`
            )
            const names = parseSkillList(listCmd.result ?? "")
            availableSkillsCache.set(source, names.length > 0 ? new Set(names) : null)
          } catch {
            availableSkillsCache.set(source, null)
          }
        }

        const available = availableSkillsCache.get(source)
        if (available && !available.has(skillId)) {
          console.warn(
            `[sandbox] Skill "${skillId}" not found in ${source}, removing stale DB record`
          )
          await prisma.skill.delete({ where: { id: skill.id } }).catch(() => {})
          continue
        }
      }

      const skillFlag = skillId ? ` --skill ${skillId}` : ""
      const installCmd = `npx -y skills add ${source}${skillFlag} --agent '*' -y`
      const cmd = await sandbox.process.executeCommand(
        `cd ${repoPath} && ${installCmd} 2>&1`
      )
      if (cmd.exitCode === 0) {
        installed++
      } else {
        console.error(
          `[sandbox] Failed to install skill ${skill.fullHandle}:`,
          cmd.result?.trim()
        )
      }
    } catch (err) {
      console.error(
        `[sandbox] Error installing skill ${skill.fullHandle}:`,
        err
      )
    }
  }

  if (installed > 0) {
    console.log(
      `[sandbox] Installed ${installed}/${skills.length} skills for ${repo}`
    )
  }

  return { installed, total: skills.length }
}

/** Strip ANSI escape codes, cursor controls, and terminal noise from CLI output */
function stripAnsi(str: string): string {
  return str
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "")   // CSI sequences (colors, cursor)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\][^\x07]*\x07/g, "")         // OSC sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B[@-Z\\-_]/g, "")              // Two-byte escape sequences
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x09\x0B\x0C\x0E-\x1F]/g, "") // Control chars (keep \n)
    .replace(/\r/g, "")                          // Carriage returns
}

/**
 * Parse the output of `npx skills add <source> --list` to extract valid
 * skill names. Output includes lines like:
 *   │    - skill-name
 */
function parseSkillList(output: string): string[] {
  const cleaned = stripAnsi(output)
  const skills: string[] = []
  for (const line of cleaned.split("\n")) {
    const match = line.match(/[-–]\s+(\S+)\s*$/)
    if (match && match[1]) {
      skills.push(match[1])
    }
  }
  return skills
}
