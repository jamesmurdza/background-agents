import { Daytona } from "@daytonaio/sdk"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { PATHS } from "@/lib/constants"
import { parseDiff, parseCommitLog } from "@/lib/utils/diff-parser"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.accessToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { sandboxId, baseBranch } = body

  if (!sandboxId || !baseBranch) {
    return Response.json(
      { error: "Missing required fields: sandboxId, baseBranch" },
      { status: 400 }
    )
  }

  const daytonaApiKey = process.env.DAYTONA_API_KEY
  if (!daytonaApiKey) {
    return Response.json({ error: "Daytona API key not configured" }, { status: 500 })
  }

  try {
    const daytona = new Daytona({ apiKey: daytonaApiKey })
    const sandbox = await daytona.get(sandboxId)
    const repoPath = PATHS.PROJECT_DIR

    // Get current branch name
    const branchResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git rev-parse --abbrev-ref HEAD 2>&1`
    )
    const currentBranch = branchResult.result.trim()

    // Fetch to ensure we have latest refs
    await sandbox.process.executeCommand(
      `cd ${repoPath} && git fetch origin ${baseBranch} 2>&1`
    )

    // Get commits since divergence
    // Format: sha|shortSha|message|author|relativeDate
    const logResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git log --oneline --format="%H|%h|%s|%an|%ar" origin/${baseBranch}...HEAD 2>&1`
    )
    const commits = parseCommitLog(logResult.exitCode === 0 ? logResult.result : "")

    // Get combined diff
    const diffResult = await sandbox.process.executeCommand(
      `cd ${repoPath} && git diff origin/${baseBranch}...HEAD 2>&1`
    )
    const diff = parseDiff(diffResult.exitCode === 0 ? diffResult.result : "")

    return Response.json({
      baseBranch,
      currentBranch,
      commits,
      files: diff.files,
      stats: {
        ...diff.stats,
        commits: commits.length,
      },
    })
  } catch (error: unknown) {
    console.error("[sandbox/git-diff] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
