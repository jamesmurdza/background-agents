import { decrypt } from "@/lib/db/encryption"
import { resolveEnvironmentForChat } from "@/lib/environments"
import { getEnvForModel, type CustomEndpoint } from "@background-agents/common"
import type { Agent } from "@/lib/agent-session"
import type { Credentials } from "@/lib/credentials"
import type { ChatRecord, MessagePayload } from "./types"

/**
 * Build the environment passed to the agent process: the model/agent system env
 * merged with the user's decrypted env vars (environment-level first, then
 * chat-level overriding). User vars take precedence over system vars.
 */
export async function buildAgentEnv(params: {
  chat: ChatRecord
  userId: string
  payload: MessagePayload
  credentials: Credentials
  customEndpoints?: CustomEndpoint[]
}): Promise<Record<string, string>> {
  const { chat, userId, payload, credentials, customEndpoints } = params

  const systemEnv = getEnvForModel(payload.model, payload.agent as Agent, credentials, customEndpoints)

  // Fetch user-defined environment variables (environment-level then chat-level, chat takes precedence)
  const userEnv: Record<string, string> = {}

  // Environment-level vars, read fresh every turn so an edit in /environments
  // takes effect on the next message rather than waiting for the sandbox to be
  // recreated. (The same values are also passed to daytona.create as sandbox
  // env for the setup script and the terminal; that copy is create-time only,
  // which is why this read has to stay.)
  const environment = await resolveEnvironmentForChat({
    userId,
    repo: chat.repo,
    environmentId: chat.environmentId ?? null,
  })
  if (environment) {
    Object.assign(userEnv, environment.variables)
  }

  // Get chat-level env vars (overrides environment-level)
  const chatEnvVars = chat.environmentVariables as Record<string, string> | null
  if (chatEnvVars) {
    for (const [key, encryptedValue] of Object.entries(chatEnvVars)) {
      if (encryptedValue) {
        userEnv[key] = decrypt(encryptedValue)
      }
    }
  }

  // Merge: system env vars first, then user env vars (user takes precedence)
  return { ...systemEnv, ...userEnv }
}
