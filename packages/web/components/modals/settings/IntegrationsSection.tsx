"use client"

import { Github, Link as LinkIcon } from "lucide-react"
import {
  GITHUB_MCP_QUALIFIED_NAME,
  GMAIL_MCP_QUALIFIED_NAME,
  PADDLE_MCP_QUALIFIED_NAME,
} from "@background-agents/mcp"
import { GmailIcon } from "@/components/icons/gmail-icon"
import { PaddleIcon } from "@/components/icons/paddle-icon"
import { McpConnectionRow, type McpConnectionRowConfig } from "./McpConnectionRow"
import { MobileSectionHeader } from "./shared"

/**
 * Account-level connect/disconnect for first-party MCP integrations. Kept in
 * sync with McpServersCombobox.tsx's FIRST_PARTY_SERVERS — same slugs, same
 * connect endpoints — but this is the account-wide surface: connecting here
 * links the account without attaching to any particular chat, and
 * disconnecting here tears down every attachment across all chats and jobs
 * (the per-chat combobox's disconnect does the same thing already, this
 * section just makes it discoverable without having to open a chat first).
 */
const INTEGRATIONS: McpConnectionRowConfig[] = [
  {
    slug: GITHUB_MCP_QUALIFIED_NAME,
    name: "GitHub",
    description: "Issues, PRs, code search via our GitHub App",
    icon: Github,
    connectApi: "/api/mcp/connect/github",
    popupName: "github-app-install",
  },
  {
    slug: GMAIL_MCP_QUALIFIED_NAME,
    name: "Gmail",
    description: "Search, read and draft email, scoped per chat",
    icon: GmailIcon,
    connectApi: "/api/mcp/connect/gmail",
    popupName: "gmail-oauth",
  },
  {
    slug: PADDLE_MCP_QUALIFIED_NAME,
    name: "Paddle",
    description: "Billing, subscriptions and customers via Paddle",
    icon: PaddleIcon,
    connectApi: "/api/mcp/connect/paddle",
    popupName: "paddle-oauth",
  },
]

export function IntegrationsSection({ isMobile }: { isMobile?: boolean }) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={LinkIcon} label="Integrations" />}
      <p className="text-xs text-muted-foreground mb-3">
        Connect accounts once here, then attach them to any chat or scheduled job from the
        MCP server picker. Disconnecting removes access everywhere it's attached.
      </p>
      {INTEGRATIONS.map((config) => (
        <McpConnectionRow key={config.slug} config={config} />
      ))}
    </div>
  )
}
