export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get("token")
  const owner = searchParams.get("owner")
  const repo = searchParams.get("repo")
  const branch = searchParams.get("branch")
  const baseBranch = searchParams.get("baseBranch")

  if (!token || !owner || !repo || !branch || !baseBranch) {
    return Response.json({ error: "Missing required parameters" }, { status: 400 })
  }

  try {
    // Use GitHub Compare API to check if branch has commits ahead of base
    // GET /repos/{owner}/{repo}/compare/{basehead}
    // basehead format: base...head
    const compareRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/compare/${baseBranch}...${branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    )

    if (!compareRes.ok) {
      // Branch might not exist on remote
      if (compareRes.status === 404) {
        return Response.json({ isMerged: false, notFound: true })
      }
      const errorData = await compareRes.json().catch(() => ({}))
      return Response.json(
        { error: (errorData as { message?: string }).message || "Failed to compare branches" },
        { status: compareRes.status }
      )
    }

    const data = await compareRes.json()

    // If ahead_by is 0, the branch has no commits that aren't in the base branch
    // This means it's fully merged
    const isMerged = data.ahead_by === 0

    return Response.json({
      isMerged,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      status: data.status // "ahead", "behind", "diverged", or "identical"
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
