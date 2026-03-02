import { Daytona } from "@daytonaio/sdk"
import { CODING_AGENT_SCRIPT } from "@/lib/coding-agent-script"

export const maxDuration = 300 // 5 minute timeout for sandbox creation

export async function POST(req: Request) {
  const body = await req.json()
  const {
    daytonaApiKey,
    anthropicApiKey,
    anthropicAuthType,
    anthropicAuthToken,
    githubPat,
    repoOwner,
    repoName,
    baseBranch,
    newBranch,
    startCommit,
  } = body

  const hasAnthropicCredential =
    (anthropicAuthType === "claude-max" && anthropicAuthToken) ||
    (anthropicAuthType !== "claude-max" && anthropicApiKey)

  if (!daytonaApiKey || !hasAnthropicCredential || !githubPat || !repoOwner || !repoName || !newBranch) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        send({ type: "progress", message: "Creating sandbox..." })

        const daytona = new Daytona({ apiKey: daytonaApiKey })
        // Name sandboxes for easy identification in Daytona dashboard
        const safeBranch = newBranch.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)
        const sandboxName = `agenthub-${repoOwner}-${repoName}-${safeBranch}`.toLowerCase().slice(0, 64)
        const sandbox = await daytona.create({
          name: sandboxName,
          snapshot: "daytona-medium",
          labels: {
            "agenthub": "true",
            "repo": `${repoOwner}/${repoName}`,
            "branch": newBranch,
          },
          ...(anthropicAuthType !== "claude-max" && {
            envVars: { ANTHROPIC_API_KEY: anthropicApiKey },
          }),
        })

        // For Claude Max, write stored credentials so the Agent SDK picks them up
        if (anthropicAuthType === "claude-max" && anthropicAuthToken) {
          const credentialsB64 = Buffer.from(anthropicAuthToken).toString("base64")
          await sandbox.process.executeCommand(
            `mkdir -p /home/daytona/.claude && echo '${credentialsB64}' | base64 -d > /home/daytona/.claude/.credentials.json && chmod 600 /home/daytona/.claude/.credentials.json`
          )
        }

        send({ type: "progress", message: "Cloning repository..." })

        // Use Daytona SDK git interface — never pass PAT to sandbox commands
        const repoPath = `/home/daytona/${repoName}`
        const cloneUrl = `https://github.com/${repoOwner}/${repoName}.git`
        const base = baseBranch || "main"
        await sandbox.git.clone(cloneUrl, repoPath, base, undefined, "x-access-token", githubPat)

        // Set up git author config (no credentials — push goes through SDK)
        await sandbox.process.executeCommand(
          `cd ${repoPath} && git config user.email "agent@agenthub.dev" && git config user.name "AgentHub"`
        )

        // Create and checkout new branch via Daytona SDK
        send({ type: "progress", message: `Creating branch ${newBranch} from ${base}...` })
        await sandbox.git.createBranch(repoPath, newBranch)
        await sandbox.git.checkoutBranch(repoPath, newBranch)

        // If starting from a specific commit, reset to it
        if (startCommit) {
          send({ type: "progress", message: `Resetting to commit ${startCommit.slice(0, 7)}...` })
          await sandbox.process.executeCommand(
            `cd ${repoPath} && git reset --hard ${startCommit} 2>&1`
          )
        }

        send({ type: "progress", message: "Installing Claude Agent SDK..." })

        const installResult = await sandbox.process.executeCommand(
          "python3 -m pip install claude-agent-sdk==0.1.19 2>&1"
        )
        if (installResult.exitCode) {
          throw new Error(`Failed to install Agent SDK: ${installResult.result}`)
        }

        send({ type: "progress", message: "Initializing agent..." })

        // Write the coding agent script to the sandbox
        const scriptB64 = Buffer.from(CODING_AGENT_SCRIPT).toString("base64")
        await sandbox.process.executeCommand(
          `echo '${scriptB64}' | base64 -d > /tmp/coding_agent.py`
        )

        // Get preview URL pattern for dev server URLs
        let previewUrlPattern: string | undefined
        try {
          const previewLink = await sandbox.getPreviewLink(3000)
          previewUrlPattern = previewLink.url.replace("3000", "{port}")
        } catch {
          // Preview URLs not available — non-critical
        }

        // Create code interpreter context with the repo as working directory
        const ctx = await sandbox.codeInterpreter.createContext(repoPath)

        // Initialize the coding agent (add /tmp to path so coding_agent.py is found)
        const initResult = await sandbox.codeInterpreter.runCode(
          `import sys; sys.path.insert(0, '/tmp'); import os, coding_agent;`,
          {
            context: ctx,
            envs: { REPO_PATH: repoPath, ...(previewUrlPattern ? { PREVIEW_URL_PATTERN: previewUrlPattern } : {}) },
          }
        )
        if (initResult.error) {
          throw new Error(`Failed to initialize agent: ${initResult.error.value}`)
        }

        send({
          type: "done",
          sandboxId: sandbox.id,
          contextId: ctx.id,
          previewUrlPattern,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error"
        send({ type: "error", message })
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
