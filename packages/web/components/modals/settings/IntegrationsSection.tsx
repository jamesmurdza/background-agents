"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Github, Link as LinkIcon, Check, Loader2 } from "lucide-react"
import {
  GITHUB_MCP_QUALIFIED_NAME,
  GMAIL_MCP_QUALIFIED_NAME,
  MCP_VENDORS,
  PADDLE_MCP_QUALIFIED_NAME,
  vendorQualifiedName,
} from "@background-agents/mcp"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/query/keys"
import { useSettingsQuery } from "@/lib/query/hooks/useSettingsQuery"
import { connectNetlify } from "@/lib/netlify-connect"
import { GmailIcon } from "@/components/icons/gmail-icon"
import { PaddleIcon } from "@/components/icons/paddle-icon"
import { McpConnectionRow, type McpConnectionRowConfig } from "./McpConnectionRow"
import { MobileSectionHeader, SettingsRow } from "./shared"

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
  ...MCP_VENDORS.map(
    (vendor): McpConnectionRowConfig => ({
      slug: vendorQualifiedName(vendor),
      name: vendor.name,
      description: vendor.description,
      iconUrl: vendor.iconUrl,
      connectApi: `/api/mcp/connect/${vendor.slug}`,
      popupName: `${vendor.slug}-oauth`,
    })
  ),
]

/**
 * Connect / disconnect Netlify, used to deploy a repo. Once the connect
 * popup closes we refetch settings, whose credential flags say whether a
 * token is stored.
 */
function NetlifyConnectionRow() {
  const queryClient = useQueryClient()
  const { data } = useSettingsQuery()
  const connected = !!data?.credentialFlags.NETLIFY_OAUTH_TOKEN
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function refreshCredentialFlags() {
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.all })
  }

  async function connect() {
    setError(null)
    setBusy(true)
    await connectNetlify()
    setBusy(false)
    refreshCredentialFlags()
  }

  async function disconnect() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/netlify/connect", { method: "DELETE" })
      if (!res.ok) throw new Error("Couldn't disconnect Netlify. Please try again.")
      refreshCredentialFlags()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsRow label="Netlify" description="Deploy a repo to your Netlify account." stacked>
      <div className="flex items-center justify-between gap-4">
        <div className="text-xs">
          {connected ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-600/30 bg-green-600/10 px-2 py-0.5 font-medium text-green-700 dark:text-green-400">
              <Check className="h-3 w-3" />
              Connected
            </span>
          ) : (
            <span className="text-muted-foreground">Not connected</span>
          )}
        </div>
        <button
          type="button"
          onClick={connected ? disconnect : connect}
          disabled={busy}
          className={cn(
            "flex items-center gap-1 text-xs disabled:opacity-50",
            connected ? "text-muted-foreground hover:text-foreground" : "text-primary hover:underline"
          )}
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {connected ? "Disconnect" : "Connect"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </SettingsRow>
  )
}

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
      <NetlifyConnectionRow />
    </div>
  )
}
