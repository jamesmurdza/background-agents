import { NextRequest } from "next/server"
import { Daytona } from "@daytonaio/sdk"
import { adaptSandbox } from "@background-agents/sdk"
import { getRuntimeThinkingCapability } from "@background-agents/sdk/thinking-runtime"
import { ALL_AGENTS, agentToProvider, type Agent } from "@background-agents/common"
import { THINKING_SERVER_TIMEOUT_MS, type ThinkingCapability } from "@background-agents/sdk/thinking"
import { getChatWithAuth, isAuthError, notFound, requireAuth } from "@/lib/db/api-helpers"
import { thinkingCapability, verifiedThinkingCapability } from "@/lib/thinking"
import { PATHS } from "@/lib/constants"
import { buildAgentEnv } from "../messages/_lib/agent-env"

// Discovery uses the same project configuration as launch, without obtaining
// credentials, refreshing OAuth, selecting a shared key, or installing anything.
// Config contents can contain sensitive values: never return/log this context.
const DISCOVERY_ENV = new Set([
  "PATH", "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "PI_CODING_AGENT_DIR",
  "OPENCODE_CONFIG", "OPENCODE_CONFIG_CONTENT", "OPENCODE_CONFIG_DIR",
  "KILO_CONFIG", "KILO_CONFIG_CONTENT", "KILO_CONFIG_DIR",
  "CUSTOM_CODEX_BASE_URL", "OPENAI_BASE_URL", "CUSTOM_OPENCODE_BASE_URL",
  "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
  "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "GOOGLE_GEMINI_BASE_URL", "GOOGLE_GENAI_USE_VERTEXAI",
  "KIMI_BASE_URL", "KIMI_CODE_BASE_URL", "KIMI_MODEL_NAME", "KIMI_MODEL_PROVIDER",
])
const json = (value: ThinkingCapability) => Response.json(value, { headers: { "Cache-Control": "private, no-store" } })

/** Read-only discovery. Never wake or provision a sandbox just to open a picker. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const auth = await requireAuth()
  if (isAuthError(auth)) return auth
  const { chatId } = await params
  const chat = await getChatWithAuth(chatId, auth.userId)
  if (!chat) return notFound("Chat not found")
  const agent = req.nextUrl.searchParams.get("agent") ?? chat.agent
  const model = req.nextUrl.searchParams.get("model") ?? chat.model ?? ""
  if (!ALL_AGENTS.includes(agent as Agent) || !model || model.length > 256) {
    return Response.json({ error: "Invalid agent or model" }, { status: 400 })
  }
  const capability = thinkingCapability(agent, model)
  const initial = verifiedThinkingCapability(agent, model)
  // Static Codex/Claude policy is only a request vocabulary. Existing sandboxes
  // still need contextual discovery, including custom routes and model aliases.
  if (!capability.control || !capability.levels.length && !capability.budget) return json(initial)
  const unavailable: ThinkingCapability = { ...initial, status: "runtime_unavailable", reason: initial.levels.length || initial.budget
    ? "This sandbox is not running. Previously verified choices are available and will be checked again when the prompt starts."
    : "This sandbox is not running, so its thinking controls have not been checked. You can choose Default, or retry after it starts." }
  const failed: ThinkingCapability = { levels: [], status: "check_failed", reason: "Could not check this sandbox's thinking support. Retry the check or choose Default; this does not mean the model lacks controls." }
  if (!chat.sandboxId) return json(unavailable)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const discovery = (async () => {
      const sandbox = await new Daytona().get(chat.sandboxId!)
      if (sandbox.state !== "started") return unavailable
      const runEnv = await buildAgentEnv({ chat, userId: auth.userId, credentials: {},
        payload: { agent, model, message: "", userMessageId: "", assistantMessageId: "" } })
      const env = Object.fromEntries(Object.entries(runEnv).filter(([name]) => DISCOVERY_ENV.has(name)))
      return getRuntimeThinkingCapability(agentToProvider[agent as Agent], model, adaptSandbox(sandbox), {
        cwd: `${PATHS.SANDBOX_HOME}/project`, env,
      })
    })()
    const result = await Promise.race([
      discovery,
      new Promise<ThinkingCapability>(resolve => { timer = setTimeout(() => resolve(failed), THINKING_SERVER_TIMEOUT_MS) }),
    ])
    return json(result)
  } catch (error) {
    // Only the type is safe to log; provider/config errors may contain secrets.
    console.warn("[thinking] Discovery failed:", error instanceof Error ? error.name : "Unknown error")
    return json(failed)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
