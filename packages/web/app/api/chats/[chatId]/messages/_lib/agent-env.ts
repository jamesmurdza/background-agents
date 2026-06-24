import { prisma } from "@/lib/db/prisma"
import { decrypt } from "@/lib/db/encryption"
import { NEW_REPOSITORY } from "@/lib/types"
import { getEnvForModel } from "@background-agents/common"
import type { Agent } from "@/lib/agent-session"
import type { Credentials } from "@/lib/credentials"
import type { ChatRecord, MessagePayload } from "./types"

/**
 * Build the environment passed to the agent process: the model/agent system env
 * merged with the user's decrypted env vars (repo-level first, then chat-level
 * overriding). User vars take precedence over system vars.
 */
export async function buildAgentEnv(params: {
  chat: ChatRecord
  userId: string
  payload: MessagePayload
  credentials: Credentials
}): Promise<Record<string, string>> {
  const { chat, userId, payload, credentials } = params

  const systemEnv = getEnvForModel(payload.model, payload.agent as Agent, credentials)

  // Fetch user-defined environment variables (repo-level then chat-level, chat takes precedence)
  const userEnv: Record<string, string> = {}

  // Get repo-level env vars from user
  if (chat.repo !== NEW_REPOSITORY) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { repoEnvironmentVariables: true },
    })
    const repoEnvVars = (user?.repoEnvironmentVariables as Record<string, Record<string, string>>)?.[chat.repo]
    if (repoEnvVars) {
      for (const [key, encryptedValue] of Object.entries(repoEnvVars)) {
        if (encryptedValue) {
          userEnv[key] = decrypt(encryptedValue)
        }
      }
    }
  }

  // Get chat-level env vars (overrides repo-level)
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
