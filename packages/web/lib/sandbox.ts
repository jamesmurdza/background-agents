/**
 * Sandbox orchestration helpers.
 *
 * Pulled out of the legacy /api/sandbox/* routes so the new
 * /api/chats/[chatId]/messages endpoint can drive sandbox lifecycle
 * directly without duplicating the bring-up sequence.
 */

import type { Daytona } from "@daytonaio/sdk"
import { randomUUID } from "crypto"
import { createSandboxGit } from "@upstream/daytona-git"
import { PATHS, SANDBOX_CONFIG } from "@/lib/constants"
import { NEW_REPOSITORY } from "@/lib/types"

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
}

export interface CreatedSandbox {
  sandbox: Awaited<ReturnType<Daytona["create"]>>
  sandboxId: string
  branch: string
  previewUrlPattern: string | undefined
  /** Always "project" in this repo, but returned so callers can plumb it through. */
  repoName: string
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
  const { daytona, repo, baseBranch, newBranch, githubToken, userId } = options
  const isNewRepo = repo === NEW_REPOSITORY || repo === "__new__"
  const repoName = "project"

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
    autoStopInterval: 10,
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
    await git.clone(
      cloneUrl,
      repoPath,
      baseBranch,
      undefined,
      "x-access-token",
      githubToken!
    )

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
    await git.createBranch(repoPath, newBranch)
    await git.checkoutBranch(repoPath, newBranch)
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
