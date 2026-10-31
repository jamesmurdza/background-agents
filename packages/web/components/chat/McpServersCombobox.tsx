"use client"

/**
 * McpServersCombobox — per-chat MCP server picker rendered as a popover.
 *
 * Replaces the old full-screen McpServersModal. Behaves like RepoCombobox:
 * a single button in the chat input opens a search dropdown over Smithery's
 * registry plus our first-party featured entries (GitHub App, Gmail). Clicking
 * a row toggles connect/disconnect; a checkmark marks rows currently attached
 * to this chat.
 */

import {
  AlertCircle,
  BadgeCheck,
  Check,
  ExternalLink,
  Github,
  Loader2,
  Plug,
  Settings,
  Trash2,
} from "lucide-react"
import { type ComponentType, type ReactNode, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  GMAIL_MCP_QUALIFIED_NAME,
  type GmailToolPolicy,
  parseGmailToolPolicy,
} from "@background-agents/mcp/gmail/policy"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { GmailIcon } from "@/components/icons/gmail-icon"
import { ComboboxTriggerButton } from "./ComboboxTriggerButton"
import { GmailSettingsDialog } from "./GmailSettingsDialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { pollUntilPopupCloses } from "@/lib/popup-poll"
import { useToastStore } from "@/lib/stores/toast-store"
import { cn } from "@/lib/utils"

interface ConnectedServer {
  id: string
  qualifiedName: string
  displayName: string
  iconUrl: string | null
  status: "pending" | "connected" | "error"
  lastError: string | null
  toolPolicy: unknown
}

interface RegistryServer {
  slug: string
  name: string
  description: string
  iconUrl: string | null
  url: string | null
  verified: boolean
  useCount: number
}

const GITHUB_QUALIFIED_NAME = "github/github"

/**
 * Servers we host or authenticate ourselves. Each links a user-level account
 * via a popup (`connectApi` GET → { connected, installUrl | authUrl }), then
 * attaches a sentinel row via POST `${apiBase}/<id>/mcp-servers/<attachPath>`.
 */
interface FirstPartyServer extends RegistryServer {
  icon: ComponentType<{ className?: string }>
  connectApi: string
  attachPath: string
  /** Popup window name, also the postMessage `source` the callback sends. */
  popupName: string
}

interface AccountStatus {
  connected: boolean
  installUrl?: string
  authUrl?: string
  installationId?: string
}

const FIRST_PARTY_SERVERS: FirstPartyServer[] = [
  {
    slug: GITHUB_QUALIFIED_NAME,
    name: "GitHub",
    description: "Issues, PRs, code search via our GitHub App",
    iconUrl: null,
    url: null,
    verified: true,
    useCount: 0,
    icon: Github,
    connectApi: "/api/mcp/connect/github",
    attachPath: "github",
    popupName: "github-app-install",
  },
  {
    slug: GMAIL_MCP_QUALIFIED_NAME,
    name: "Gmail",
    description: "Search, read and draft email, scoped per chat",
    iconUrl: null,
    url: null,
    verified: true,
    useCount: 0,
    icon: GmailIcon,
    connectApi: "/api/mcp/connect/gmail",
    attachPath: "gmail",
    popupName: "gmail-oauth",
  },
]

const FIRST_PARTY_BY_SLUG = new Map(FIRST_PARTY_SERVERS.map((s) => [s.slug, s]))

/** Smithery's Gmail servers are superseded by our own; hide them unless attached. */
function isSupersededRegistryServer(s: RegistryServer): boolean {
  return /gmail/i.test(s.slug) || /gmail/i.test(s.name)
}

/** Pending account unlink, confirmed through ConfirmDialog. */
interface UnlinkRequest {
  server: FirstPartyServer
  title: string
  description: string
  confirmLabel: string
}

/** Wait until the popup reports back via postMessage or is closed. */
function waitForPopup(popup: Window, source: string): Promise<void> {
  return new Promise((resolve) => pollUntilPopupCloses(popup, resolve, { messageSource: source }))
}

interface McpServersComboboxProps {
  /** Stable id of the owning entity (chat id or scheduled job id). */
  entityId: string
  /**
   * API path prefix for the owning entity, without trailing slash and without
   * the entity id, e.g. `"/api/chats"` or `"/api/scheduled-jobs"`. The
   * component appends `/{entityId}/mcp-servers/...` to this for all calls.
   */
  apiBase: string
  /**
   * True if `entityId` is a not-yet-persisted draft. Only the chat flow uses
   * this; scheduled jobs are edit-only so default is false.
   */
  isDraft?: boolean
  /**
   * Called when a draft needs to be materialized before the first MCP write.
   * Returns the real id (or null on failure). Only used when `isDraft` is true.
   */
  onMaterializeDraft?: (draftId: string) => Promise<string | null>
  disabled?: boolean
  isMobile?: boolean
  /** Optional controlled open state (e.g. from the command palette). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Forces the trigger label on/off regardless of available space (e.g. a
   * parent coordinating several triggers' labels as one group). Omit to let
   * the trigger decide for itself based on its own available room.
   */
  showLabel?: boolean
}

export function McpServersCombobox({
  entityId,
  apiBase,
  isDraft: isDraftProp = false,
  onMaterializeDraft,
  disabled = false,
  isMobile = false,
  open: openProp,
  onOpenChange,
  showLabel,
}: McpServersComboboxProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      setInternalOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange]
  )

  // Effective id used for all entity-scoped API calls. Starts as the
  // (possibly draft) entityId and is replaced with the real id once we
  // materialize on first commit (chat flow only).
  const [effectiveId, setEffectiveId] = useState(entityId)
  const [isDraft, setIsDraft] = useState(isDraftProp)

  useEffect(() => {
    setEffectiveId(entityId)
    setIsDraft(isDraftProp)
  }, [entityId, isDraftProp])

  const resolveEntityId = useCallback(async (): Promise<string | null> => {
    if (!isDraft) return effectiveId
    if (!onMaterializeDraft) return effectiveId
    const realId = await onMaterializeDraft(effectiveId)
    if (!realId) return null
    setEffectiveId(realId)
    setIsDraft(false)
    return realId
  }, [isDraft, effectiveId, onMaterializeDraft])

  const [connected, setConnected] = useState<ConnectedServer[]>([])
  const [registry, setRegistry] = useState<RegistryServer[]>([])
  const [loadingRegistry, setLoadingRegistry] = useState(false)
  const [hasLoadedRegistry, setHasLoadedRegistry] = useState(false)
  const [search, setSearch] = useState("")
  const [busySlug, setBusySlug] = useState<string | null>(null)
  // User-level account links per first-party slug, tracked separately from
  // `connected` because an account (GitHub App install, Google grant) can be
  // linked even when no chat has the server attached.
  const [accountStatus, setAccountStatus] = useState<Record<string, AccountStatus>>({})
  const githubInstallationId = accountStatus[GITHUB_QUALIFIED_NAME]?.installationId ?? null

  const [gmailSettingsOpen, setGmailSettingsOpen] = useState(false)
  const [unlinkRequest, setUnlinkRequest] = useState<UnlinkRequest | null>(null)
  const addToast = useToastStore((s) => s.addToast)

  const popupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const connectedByName = useMemo(() => {
    const m = new Map<string, ConnectedServer>()
    connected.forEach((s) => m.set(s.qualifiedName, s))
    return m
  }, [connected])

  const gmailServer = connectedByName.get(GMAIL_MCP_QUALIFIED_NAME) ?? null
  // Keyed on the policy's content so a refetch of the same rows doesn't reset
  // unsaved edits in the open settings dialog.
  const gmailPolicyJson = gmailServer ? JSON.stringify(gmailServer.toolPolicy ?? null) : null
  const gmailPolicy = useMemo(
    () => (gmailPolicyJson === null ? null : parseGmailToolPolicy(JSON.parse(gmailPolicyJson))),
    [gmailPolicyJson]
  )

  const loadConnectedFor = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiBase}/${id}/mcp-servers`)
      if (res.ok) {
        const data = await res.json()
        setConnected(data.servers || [])
      }
    } catch (err) {
      console.error("[McpServersCombobox] loadConnected failed:", err)
    }
  }, [apiBase])

  const loadConnected = useCallback(async () => {
    if (isDraft) {
      setConnected([])
      return
    }
    await loadConnectedFor(effectiveId)
  }, [isDraft, effectiveId, loadConnectedFor])

  const loadAccountStatus = useCallback(async (): Promise<Record<string, AccountStatus>> => {
    const entries = await Promise.all(
      FIRST_PARTY_SERVERS.map(async (s): Promise<[string, AccountStatus]> => {
        try {
          const res = await fetch(s.connectApi)
          return [s.slug, res.ok ? await res.json() : { connected: false }]
        } catch (err) {
          console.error(`[McpServersCombobox] ${s.name} status failed:`, err)
          return [s.slug, { connected: false }]
        }
      })
    )
    const next = Object.fromEntries(entries)
    setAccountStatus(next)
    return next
  }, [])

  const loadRegistry = useCallback(async (q: string) => {
    setLoadingRegistry(true)
    try {
      const params = new URLSearchParams({ page: "1" })
      if (q) params.set("search", q)
      const res = await fetch(`/api/mcp-registry?${params}`)
      if (res.ok) {
        const data = await res.json()
        setRegistry(data.servers || [])
      }
    } catch (err) {
      console.error("[McpServersCombobox] loadRegistry failed:", err)
    } finally {
      setLoadingRegistry(false)
      setHasLoadedRegistry(true)
    }
  }, [])

  // Load connected list on mount (for the badge count) and when popover opens.
  useEffect(() => {
    loadConnected()
  }, [loadConnected])

  // Load account link status whenever the popover opens.
  useEffect(() => {
    if (open) {
      loadConnected() // Refresh when opening
      loadAccountStatus()
    }
  }, [open, loadConnected, loadAccountStatus])

  // Debounced registry search while the popover is open.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => loadRegistry(search), 300)
    return () => clearTimeout(t)
  }, [open, search, loadRegistry])

  // Reset search when popover closes.
  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  useEffect(() => {
    return () => {
      if (popupTimerRef.current) clearInterval(popupTimerRef.current)
    }
  }, [])

  // ---------- actions ----------

  async function handleDisconnect(serverId: string) {
    if (isDraft) return
    try {
      const res = await fetch(
        `${apiBase}/${effectiveId}/mcp-servers/${serverId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        setConnected((prev) => prev.filter((s) => s.id !== serverId))
      }
    } catch (err) {
      console.error("[McpServersCombobox] disconnect failed:", err)
    }
  }

  async function handleToggleFirstParty(server: FirstPartyServer) {
    const existing = connectedByName.get(server.slug)
    if (existing) {
      setBusySlug(server.slug)
      try {
        await handleDisconnect(existing.id)
      } finally {
        setBusySlug(null)
      }
      return
    }
    if (busySlug) return
    setBusySlug(server.slug)
    try {
      let status = (await loadAccountStatus())[server.slug]
      if (!status?.connected) {
        const popupUrl = status?.installUrl ?? status?.authUrl
        if (!popupUrl) throw new Error(`${server.name} is not configured on the server`)
        const popup = window.open(
          popupUrl,
          server.popupName,
          "width=600,height=700,scrollbars=yes"
        )
        if (!popup || popup.closed) return
        await waitForPopup(popup, server.popupName)
        status = (await loadAccountStatus())[server.slug]
        if (!status?.connected) return
      }

      const id = await resolveEntityId()
      if (!id) return
      const res = await fetch(`${apiBase}/${id}/mcp-servers/${server.attachPath}`, {
        method: "POST",
      })
      if (res.ok) await loadConnectedFor(id)
    } catch (err) {
      console.error(`[McpServersCombobox] ${server.name} connect failed:`, err)
    } finally {
      setBusySlug(null)
    }
  }

  /**
   * Hard unlink of the user-level account (GitHub App install or Google
   * grant). The server drops this server's rows across every chat and job.
   */
  async function handleUnlinkAccount(server: FirstPartyServer) {
    setBusySlug(server.slug)
    try {
      const res = await fetch(server.connectApi, { method: "DELETE" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await Promise.all([loadAccountStatus(), loadConnected()])
    } catch (err) {
      console.error(`[McpServersCombobox] ${server.name} unlink failed:`, err)
      addToast({ title: `Couldn't disconnect ${server.name}`, body: "Please try again." })
    } finally {
      setBusySlug(null)
    }
  }

  /** Throws a user-facing message so the settings dialog can show it. */
  async function handleUpdateToolPolicy(serverId: string, toolPolicy: GmailToolPolicy) {
    let res: Response
    try {
      res = await fetch(`${apiBase}/${effectiveId}/mcp-servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolPolicy }),
      })
    } catch (err) {
      console.error("[McpServersCombobox] tool policy update failed:", err)
      throw new Error("Network error. Check your connection and try again.")
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      console.error("[McpServersCombobox] tool policy update failed:", res.status, data?.error)
      throw new Error(data?.error || "Couldn't save Gmail settings")
    }
    setConnected((prev) =>
      prev.map((s) => (s.id === serverId ? { ...s, toolPolicy } : s))
    )
  }

  function openGmailSettings() {
    // Close the picker first: it would dismiss itself anyway once focus moves
    // into the dialog.
    setOpen(false)
    setGmailSettingsOpen(true)
  }

  async function handleToggleServer(server: RegistryServer) {
    const existing = connectedByName.get(server.slug)
    if (existing) {
      setBusySlug(server.slug)
      try {
        await handleDisconnect(existing.id)
      } finally {
        setBusySlug(null)
      }
      return
    }
    if (busySlug) return
    setBusySlug(server.slug)
    try {
      let url = server.url
      if (!url) {
        const detailRes = await fetch(`/api/mcp-registry/${server.slug}`)
        if (!detailRes.ok) throw new Error("Failed to fetch server details")
        const detail = await detailRes.json()
        url = detail.url
        if (!url) throw new Error("Server does not expose a remote URL")
      }

      const id = await resolveEntityId()
      if (!id) {
        setBusySlug(null)
        return
      }

      const res = await fetch(`${apiBase}/${id}/mcp-servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: server.slug,
          url,
          name: server.name,
          iconUrl: server.iconUrl,
        }),
      })
      const data = await res.json()
      if (!res.ok && data.state !== "input_required") {
        throw new Error(data.error || "Connect failed")
      }

      if (data.connected) {
        setBusySlug(null)
        await loadConnectedFor(id)
        return
      }

      // Setup or auth required: open the appropriate URL in a popup and poll for close.
      const popupUrl = data.state === "input_required" ? data.setupUrl : data.authUrl
      if (!popupUrl) {
        throw new Error("Server requires configuration but no setup URL provided")
      }
      const popup = window.open(
        popupUrl,
        "smithery-oauth",
        "width=600,height=700,scrollbars=yes"
      )
      if (!popup || popup.closed) {
        setBusySlug(null)
        return
      }

      if (popupTimerRef.current) clearInterval(popupTimerRef.current)
      popupTimerRef.current = pollUntilPopupCloses(popup, async () => {
        popupTimerRef.current = null
        try {
          await fetch(
            `${apiBase}/${id}/mcp-servers/${data.serverId}/smithery-finalize`,
            { method: "POST" }
          )
        } catch (err) {
          console.error("[McpServersCombobox] finalize failed:", err)
        }
        setBusySlug(null)
        await loadConnectedFor(id)
      })
    } catch (err) {
      console.error("[McpServersCombobox] toggle failed:", err)
      setBusySlug(null)
    }
  }

  // ---------- render ----------

  const connectedCount = connected.length
  const triggerLabel = `MCP servers${connectedCount > 0 ? `, ${connectedCount} connected` : ""}`

  // Combine first-party + registry, filter by search, sort connected to top
  const allServers = useMemo(() => {
    const searchLower = search.toLowerCase().trim()
    const matches = (s: RegistryServer) =>
      !searchLower ||
      s.name.toLowerCase().includes(searchLower) ||
      s.description.toLowerCase().includes(searchLower) ||
      s.slug.toLowerCase().includes(searchLower)

    const combined = [
      ...FIRST_PARTY_SERVERS.filter(matches),
      ...registry.filter(
        (s) =>
          matches(s) &&
          (connectedByName.has(s.slug) || !isSupersededRegistryServer(s))
      ),
    ]

    // Sort: connected servers first
    return combined.sort((a, b) => {
      const aConnected = connectedByName.has(a.slug)
      const bConnected = connectedByName.has(b.slug)
      if (aConnected && !bConnected) return -1
      if (!aConnected && bConnected) return 1
      return 0
    })
  }, [search, registry, connectedByName])

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ComboboxTriggerButton
          disabled={disabled}
          isMobile={isMobile}
          showLabel={showLabel}
          title={triggerLabel}
          aria-label={triggerLabel}
          icon={<Plug className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />}
          label={
            <>
              MCP
              {connectedCount > 0 && (
                <span className="ml-1 text-foreground/80">({connectedCount})</span>
              )}
            </>
          }
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 max-h-[var(--radix-popover-content-available-height)] overflow-hidden"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search MCP servers..."
            value={search}
            onValueChange={setSearch}
            rightSlot={
              hasLoadedRegistry && loadingRegistry ? (
                <Loader2
                  className="h-4 w-4 animate-spin text-muted-foreground shrink-0"
                  aria-label="Searching"
                />
              ) : null
            }
          />
          <CommandList className="h-[min(252px,calc(var(--radix-popover-content-available-height)_-_48px))]">
            {!hasLoadedRegistry ? (
              <div
                className="flex items-center justify-center h-[min(252px,calc(var(--radix-popover-content-available-height)_-_48px))]"
                role="status"
                aria-label="Loading MCP servers"
              >
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : allServers.length === 0 && !loadingRegistry ? (
              <CommandEmpty className="flex items-center justify-center h-[min(252px,calc(var(--radix-popover-content-available-height)_-_48px))] py-0">
                No servers found
              </CommandEmpty>
            ) : (
              allServers.map((s) => {
                const firstParty = FIRST_PARTY_BY_SLUG.get(s.slug)
                const connectedServer = connectedByName.get(s.slug)
                const isConn = !!connectedServer
                const hasError = connectedServer?.status === "error"
                const isPending = connectedServer?.status === "pending"
                const isBusy = busySlug === s.slug
                const handleSelect = firstParty
                  ? () => handleToggleFirstParty(firstParty)
                  : () => handleToggleServer(s)

                // Build status label for screen readers
                let statusLabel = ""
                if (isBusy) statusLabel = "Connecting"
                else if (hasError) statusLabel = `Error: ${connectedServer?.lastError || "Connection failed"}`
                else if (isPending) statusLabel = "Connection pending"
                else if (isConn) statusLabel = "Connected"

                return (
                  <CommandItem
                    key={s.slug}
                    value={s.slug}
                    onSelect={handleSelect}
                    disabled={isBusy}
                    className="flex items-center gap-2 cursor-pointer"
                    aria-label={`${s.name}${statusLabel ? `, ${statusLabel}` : ""}`}
                  >
                    {firstParty ? (
                      <div
                        className="h-6 w-6 rounded bg-muted shrink-0 flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <firstParty.icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    ) : s.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.iconUrl}
                        alt={`${s.name} icon`}
                        className="h-6 w-6 rounded shrink-0"
                      />
                    ) : (
                      <div
                        className="h-6 w-6 rounded bg-muted shrink-0 flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="text-sm font-medium truncate">
                          {s.name}
                        </span>
                        {s.verified && (
                          <BadgeCheck
                            className="h-3 w-3 text-blue-500 shrink-0"
                            aria-label="Verified"
                          />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {hasError ? (
                          <span className="text-destructive">
                            {connectedServer?.lastError || "Connection failed"}
                          </span>
                        ) : (
                          s.description
                        )}
                      </div>
                    </div>
                    {firstParty?.slug === GITHUB_QUALIFIED_NAME && githubInstallationId && (
                      <RowSettingsMenu label="GitHub settings" disabled={isBusy}>
                        <DropdownMenuItem asChild>
                          <a
                            href={`https://github.com/settings/installations/${githubInstallationId}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded-sm hover:bg-accent"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Manage repositories
                          </a>
                        </DropdownMenuItem>
                        <UnlinkMenuItem
                          label="Uninstall app entirely"
                          onSelect={() =>
                            setUnlinkRequest({
                              server: firstParty,
                              title: "Uninstall GitHub App?",
                              description:
                                "This uninstalls the GitHub App from your account and removes GitHub MCP from every chat and scheduled job.",
                              confirmLabel: "Uninstall",
                            })
                          }
                        />
                      </RowSettingsMenu>
                    )}
                    {firstParty?.slug === GMAIL_MCP_QUALIFIED_NAME &&
                      (connectedServer || accountStatus[s.slug]?.connected) && (
                        <RowSettingsButton
                          label="Gmail settings"
                          disabled={isBusy}
                          onClick={openGmailSettings}
                        />
                      )}
                    {/* Status indicator */}
                    {isBusy ? (
                      <Loader2
                        className="h-4 w-4 animate-spin text-muted-foreground"
                        aria-hidden="true"
                      />
                    ) : hasError ? (
                      <AlertCircle
                        className="h-4 w-4 text-destructive"
                        aria-hidden="true"
                      />
                    ) : isConn ? (
                      <Check
                        className="h-4 w-4 text-primary"
                        aria-hidden="true"
                      />
                    ) : null}
                  </CommandItem>
                )
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    <GmailSettingsDialog
      open={gmailSettingsOpen}
      onClose={() => setGmailSettingsOpen(false)}
      policy={gmailPolicy}
      onSave={(policy) =>
        gmailServer
          ? handleUpdateToolPolicy(gmailServer.id, policy)
          : Promise.reject(new Error("Gmail is no longer attached"))
      }
      onDisconnectAccount={
        accountStatus[GMAIL_MCP_QUALIFIED_NAME]?.connected
          ? () =>
              setUnlinkRequest({
                server: FIRST_PARTY_BY_SLUG.get(GMAIL_MCP_QUALIFIED_NAME)!,
                title: "Disconnect Google account?",
                description:
                  "Gmail MCP will be removed from every chat and scheduled job. You can reconnect it at any time.",
                confirmLabel: "Disconnect",
              })
          : undefined
      }
      entityLabel={apiBase === "/api/scheduled-jobs" ? "scheduled job" : "chat"}
      isMobile={isMobile}
    />
    <ConfirmDialog
      open={!!unlinkRequest}
      onClose={() => setUnlinkRequest(null)}
      onConfirm={() => {
        if (!unlinkRequest) return
        setGmailSettingsOpen(false)
        void handleUnlinkAccount(unlinkRequest.server)
      }}
      title={unlinkRequest?.title ?? ""}
      description={unlinkRequest?.description}
      confirmLabel={unlinkRequest?.confirmLabel}
      variant="destructive"
      isMobile={isMobile}
    />
    </>
  )
}

const ROW_SETTINGS_BUTTON =
  "p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"

/**
 * Keeps events inside a row control from reaching the enclosing CommandItem.
 * React bubbles events through portals along the component tree, so without
 * this a click (or Enter) inside a portaled menu also fires cmdk's row
 * select, which toggles the server off.
 */
function RowControl({ children }: { children: ReactNode }) {
  const stop = (e: SyntheticEvent) => e.stopPropagation()
  return (
    <div
      className="contents"
      onClick={stop}
      onPointerDown={stop}
      onPointerUp={stop}
      onKeyDown={stop}
    >
      {children}
    </div>
  )
}

/** Gear button that opens a settings dialog for a first-party row. */
function RowSettingsButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <RowControl>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={ROW_SETTINGS_BUTTON}
        aria-label={label}
        title={label}
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
    </RowControl>
  )
}

/** Gear button + dropdown on a first-party row. */
function RowSettingsMenu({
  label,
  disabled,
  children,
}: {
  label: string
  disabled: boolean
  children: ReactNode
}) {
  return (
    <RowControl>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={ROW_SETTINGS_BUTTON}
            aria-label={label}
            title={label}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">{children}</DropdownMenuContent>
      </DropdownMenu>
    </RowControl>
  )
}

function UnlinkMenuItem({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </DropdownMenuItem>
  )
}
