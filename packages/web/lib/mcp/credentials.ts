/**
 * Users' MCP logins, one McpCredential row per user and provider: "github"
 * (GitHub App installation id), "gmail" (Google refresh token) or a vendor
 * slug from MCP_VENDORS (OAuth tokens, see ./vendors).
 */
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

export const GITHUB_CREDENTIAL = "github"
export const GMAIL_CREDENTIAL = "gmail"

type CredentialData = Omit<
  Prisma.McpCredentialUncheckedCreateInput,
  "id" | "userId" | "provider" | "createdAt" | "updatedAt"
>

export function findMcpCredential(userId: string, provider: string) {
  return prisma.mcpCredential.findUnique({
    where: { userId_provider: { userId, provider } },
  })
}

/** Store the user's credential for a provider, replacing the given fields. */
export function saveMcpCredential(userId: string, provider: string, data: CredentialData) {
  return prisma.mcpCredential.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...data },
    update: data,
  })
}

export function deleteMcpCredential(userId: string, provider: string) {
  return prisma.mcpCredential.deleteMany({ where: { userId, provider } })
}
