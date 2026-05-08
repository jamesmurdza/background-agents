import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { prisma } from "@/lib/db/prisma"
import {
  requireAuth,
  isAuthError,
  badRequest,
  notFound,
  internalError,
  serverConfigError,
} from "@/lib/db/api-helpers"
import { PATHS } from "@/lib/constants"

// =============================================================================
// POST - Install skills into a chat's sandbox
// =============================================================================

interface InstallBody {
  chatId: string
  skillIds?: string[] // If omitted, install ALL skills for the chat's repo
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
 * Extract a clean, human-readable error from CLI output.
 * Looks for known error patterns instead of dumping the full banner.
 */
function extractCleanError(raw: string): string {
  const cleaned = stripAnsi(raw)
  const noMatch = cleaned.match(/No matching skills found for:\s*(.+)/i)
  if (noMatch) return `Skill "${noMatch[1].trim()}" not found in this repository`
  if (cleaned.includes("Authentication failed")) return "Repository authentication failed"
  if (cleaned.includes("Installation failed")) return "Installation failed"
  return "Install failed"
}

/**
 * Parse the output of `npx skills add <source> --list` to extract valid
 * skill names. Output format includes lines like:
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

/**
 * Run `npx skills add <source> --list` in the sandbox to discover which
 * skills are actually available in the repo. Returns a Set of valid skill
 * names, or null if the list command itself failed.
 */
async function listAvailableSkills(
  sandbox: Awaited<ReturnType<Daytona["get"]>>,
  repoPath: string,
  source: string
): Promise<Set<string> | null> {
  try {
    const cmd = await sandbox.process.executeCommand(
      `cd ${repoPath} && npx -y skills add ${source} --list 2>&1`
    )
    if (cmd.exitCode !== 0 && !cmd.result?.includes("Found")) {
      console.error(`[skills/install] --list failed for ${source}:`, cmd.result?.trim())
      return null
    }
    const names = parseSkillList(cmd.result ?? "")
    return names.length > 0 ? new Set(names) : null
  } catch (err) {
    console.error(`[skills/install] --list error for ${source}:`, err)
    return null
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const authResult = await requireAuth()
  if (isAuthError(authResult)) return authResult
  const { userId } = authResult

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) return serverConfigError("DAYTONA_API_KEY")

  try {
    const body: InstallBody = await req.json()

    if (!body.chatId) {
      return badRequest("chatId is required")
    }

    // Verify chat ownership and get sandbox info
    const chat = await prisma.chat.findUnique({
      where: { id: body.chatId },
      select: { userId: true, sandboxId: true, repo: true },
    })

    if (!chat || chat.userId !== userId) {
      return notFound("Chat not found")
    }

    if (!chat.sandboxId) {
      return badRequest("Chat has no sandbox — send a message first")
    }

    // Fetch skills to install
    const whereClause: { userId: string; repo: string; id?: { in: string[] } } = {
      userId,
      repo: chat.repo,
    }
    if (body.skillIds && body.skillIds.length > 0) {
      whereClause.id = { in: body.skillIds }
    }

    const skills = await prisma.skill.findMany({
      where: whereClause,
      orderBy: { createdAt: "asc" },
    })

    if (skills.length === 0) {
      return Response.json({ installed: 0, total: 0, results: [] })
    }

    // Connect to sandbox
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(chat.sandboxId)

    const repoPath = `${PATHS.SANDBOX_HOME}/project`
    const results: { fullHandle: string; success: boolean; error?: string }[] = []

    // ── Pre-validate: group skills by source repo, run --list for each ────
    // Cache available skills per source repo so we only clone once per repo
    const availableSkillsCache = new Map<string, Set<string> | null>()

    for (const skill of skills) {
      const parts = skill.fullHandle.split("/")
      const source = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : skill.fullHandle
      const skillId = parts.length >= 3 ? parts.slice(2).join("/") : null

      // If there's a specific skillId, validate it exists in the repo
      if (skillId) {
        if (!availableSkillsCache.has(source)) {
          const available = await listAvailableSkills(sandbox, repoPath, source)
          availableSkillsCache.set(source, available)
        }

        const available = availableSkillsCache.get(source)
        if (available && !available.has(skillId)) {
          // Skill doesn't exist in the repo — skip install, remove from DB
          results.push({
            fullHandle: skill.fullHandle,
            success: false,
            error: `Skill "${skillId}" not found in ${source}. Available: ${[...available].slice(0, 5).join(", ")}${available.size > 5 ? "..." : ""}`,
          })
          // Clean up the invalid DB record
          await prisma.skill.delete({ where: { id: skill.id } }).catch(() => {})
          continue
        }
      }

      // Validated — proceed with install
      try {
        const skillFlag = skillId ? ` --skill ${skillId}` : ""
        const installCmd = `npx -y skills add ${source}${skillFlag} --agent '*' -y`
        const cmd = await sandbox.process.executeCommand(
          `cd ${repoPath} && ${installCmd} 2>&1`
        )
        const success = cmd.exitCode === 0
        if (!success) {
          // Install failed — clean up the DB record
          await prisma.skill.delete({ where: { id: skill.id } }).catch(() => {})
        }
        results.push({
          fullHandle: skill.fullHandle,
          success,
          error: success ? undefined : extractCleanError(cmd.result ?? ""),
        })
      } catch (error) {
        results.push({
          fullHandle: skill.fullHandle,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    }

    const installed = results.filter((r) => r.success).length
    return Response.json({ installed, total: skills.length, results })
  } catch (error) {
    return internalError(error)
  }
}
