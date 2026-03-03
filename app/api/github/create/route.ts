export async function POST(req: Request) {
  const body = await req.json()
  const { token, name, description, isPrivate } = body

  if (!token || !name) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  try {
    const res = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        description: description || undefined,
        private: isPrivate ?? false,
        auto_init: true,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      throw new Error((data as { message?: string }).message || `GitHub API error: ${res.status}`)
    }

    return Response.json({
      name: data.name,
      owner: data.owner.login,
      avatar: data.owner.avatar_url,
      defaultBranch: data.default_branch,
      fullName: data.full_name,
      private: data.private,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return Response.json({ error: message }, { status: 500 })
  }
}
