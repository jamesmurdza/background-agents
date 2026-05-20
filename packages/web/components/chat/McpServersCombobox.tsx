"use client"

/**
 * McpServersCombobox — per-chat MCP server picker rendered as a popover.
 *
 * Replaces the old full-screen McpServersModal. Behaves like RepoCombobox:
 * a single button in the chat input opens a search dropdown over Smithery's
 * registry plus our GitHub-App-backed featured entry. Clicking a row toggles
 * connect/disconnect; a checkmark marks rows currently attached to this chat.
 */

import {
  AlertCircle,
  BadgeCheck,
  Check,
  ChevronDown,
  ExternalLink,
  Github,
  Loader2,
  Plug,
  Settings,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
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
import { cn } from "@/lib/utils"

interface ConnectedServer {
  id: string
  qualifiedName: string
  displayName: string
  iconUrl: string | null
  status: "pending" | "connected" | "error"
  lastError: string | null
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

interface McpServersComboboxProps {
  chatId: string
  isDraftChat: boolean
  onMaterializeDraft: (draftId: string) => Promise<string | null>
  disabled?: boolean
  isMobile?: boolean
  /** Optional controlled open state (e.g. from the command palette). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function McpServersCombobox({
  chatId,
  isDraftChat,
  onMaterializeDraft,
  disabled = false,
  isMobile = false,
  open: openProp,
  onOpenChange,
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

  // Effective chat id used for all chat-scoped API calls. Starts as the
  // (possibly draft) chatId and is replaced with the real id once we
  // materialize on first commit.
  const [effectiveChatId, setEffectiveChatId] = useState(chatId)
  const [isDraft, setIsDraft] = useState(isDraftChat)

  useEffect(() => {
    setEffectiveChatId(chatId)
    setIsDraft(isDraftChat)
  }, [chatId, isDraftChat])

  const resolveChatId = useCallback(async (): Promise<string | null> => {
    if (!isDraft) return effectiveChatId
    const realId = await onMaterializeDraft(effectiveChatId)
    if (!realId) return null
    setEffectiveChatId(realId)
    setIsDraft(false)
    return realId
  }, [isDraft, effectiveChatId, onMaterializeDraft])

  const [connected, setConnected] = useState<ConnectedServer[]>([])
  const [registry, setRegistry] = useState<RegistryServer[]>([])
  const [loadingRegistry, setLoadingRegistry] = useState(false)
  const [search, setSearch] = useState("")
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [githubBusy, setGithubBusy] = useState(false)
  // Tracked separately from `connected` because the GitHub App can be
  // installed at the user level even when no chat has it attached — we
  // need the installation id to build the "Manage repositories" link.
  const [githubInstallationId, setGithubInstallationId] = useState<string | null>(null)

  const popupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const connectedByName = useMemo(() => {
    const m = new Map<string, ConnectedServer>()
    connected.forEach((s) => m.set(s.qualifiedName, s))
    return m
  }, [connected])

  const loadConnectedFor = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/chats/${id}/mcp-servers`)
      if (res.ok) {
        const data = await res.json()
        setConnected(data.servers || [])
      }
    } catch (err) {
      console.error("[McpServersCombobox] loadConnected failed:", err)
    }
  }, [])

  const loadConnected = useCallback(async () => {
    if (isDraft) {
      setConnected([])
      return
    }
    await loadConnectedFor(effectiveChatId)
  }, [isDraft, effectiveChatId, loadConnectedFor])

  const loadGithubStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/connect/github")
      if (res.ok) {
        const data = await res.json()
        setGithubInstallationId(data.installationId ?? null)
      } else {
        setGithubInstallationId(null)
      }
    } catch {
      setGithubInstallationId(null)
    }
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
    }
  }, [])

  // Load connected list on mount (for the badge count) and when popover opens.
  useEffect(() => {
    loadConnected()
  }, [loadConnected])

  // Load GitHub app status whenever the popover opens.
  useEffect(() => {
    if (open) {
      loadConnected() // Refresh when opening
      loadGithubStatus()
    }
  }, [open, loadConnected, loadGithubStatus])

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
        `/api/chats/${effectiveChatId}/mcp-servers/${serverId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        setConnected((prev) => prev.filter((s) => s.id !== serverId))
      }
    } catch (err) {
      console.error("[McpServersCombobox] disconnect failed:", err)
    }
  }

  async function addGithubToChat() {
    const id = await resolveChatId()
    if (!id) return
    const res = await fetch(`/api/chats/${id}/mcp-servers/github`, {
      method: "POST",
    })
    if (res.ok) await loadConnectedFor(id)
  }

  async function handleToggleGithub() {
    const existing = connectedByName.get(GITHUB_QUALIFIED_NAME)
    if (existing) {
      setGithubBusy(true)
      try {
        await handleDisconnect(existing.id)
      } finally {
        setGithubBusy(false)
      }
      return
    }
    if (githubBusy) return
    setGithubBusy(true)
    try {
      const statusRes = await fetch("/api/mcp/connect/github")
      if (!statusRes.ok) throw new Error("Failed to check GitHub status")
      const status = await statusRes.json()

      if (status.connected) {
        await addGithubToChat()
        return
      }

      const popup = window.open(
        status.installUrl,
        "github-app-install",
        "width=600,height=700,scrollbars=yes"
      )
      if (!popup || popup.closed) return

      await new Promise<void>((resolve) => {
        function onMessage(e: MessageEvent) {
          const data = e.data as { source?: string; ok?: boolean } | null
          if (data?.source === "github-app-install") {
            window.removeEventListener("message", onMessage)
            resolve()
          }
        }
        window.addEventListener("message", onMessage)
        const t = setInterval(() => {
          if (popup.closed) {
            clearInterval(t)
            window.removeEventListener("message", onMessage)
            resolve()
          }
        }, 500)
      })

      const after = await fetch("/api/mcp/connect/github")
      const afterData = after.ok ? await after.json() : { connected: false }
      setGithubInstallationId(afterData.installationId ?? null)
      if (afterData.connected) await addGithubToChat()
    } catch (err) {
      console.error("[McpServersCombobox] handleToggleGithub failed:", err)
    } finally {
      setGithubBusy(false)
    }
  }

  /**
   * Hard uninstall: clears installationId on the user and drops every GitHub
   * MCP row across this user's chats. The App itself stays installed on
   * github.com until the user removes it there — we just lose access.
   */
  async function handleUninstallGithubApp() {
    if (
      !confirm(
        "Uninstall the GitHub App for your account? This removes GitHub MCP from every chat."
      )
    ) {
      return
    }
    setGithubBusy(true)
    try {
      const res = await fetch("/api/mcp/connect/github", { method: "DELETE" })
      if (res.ok) {
        setGithubInstallationId(null)
        await loadConnected()
      }
    } finally {
      setGithubBusy(false)
    }
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

      const id = await resolveChatId()
      if (!id) {
        setBusySlug(null)
        return
      }

      const res = await fetch(`/api/chats/${id}/mcp-servers`, {
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
      popupTimerRef.current = setInterval(async () => {
        if (!popup.closed) return
        if (popupTimerRef.current) {
          clearInterval(popupTimerRef.current)
          popupTimerRef.current = null
        }
        try {
          await fetch(
            `/api/chats/${id}/mcp-servers/${data.serverId}/smithery-finalize`,
            { method: "POST" }
          )
        } catch (err) {
          console.error("[McpServersCombobox] finalize failed:", err)
        }
        setBusySlug(null)
        await loadConnectedFor(id)
      }, 500)
    } catch (err) {
      console.error("[McpServersCombobox] toggle failed:", err)
      setBusySlug(null)
    }
  }

  // ---------- render ----------

  const connectedCount = connected.length

  // Create a virtual "GitHub" server entry to unify with registry servers
  const githubServer: RegistryServer = {
    slug: GITHUB_QUALIFIED_NAME,
    name: "GitHub",
    description: "Issues, PRs, code search via our GitHub App",
    iconUrl: null,
    url: null,
    verified: true,
    useCount: 0,
  }

  // Combine GitHub + registry, filter by search, sort connected to top
  const allServers = useMemo(() => {
    const searchLower = search.toLowerCase().trim()

    // Filter GitHub server
    const githubMatches = !searchLower ||
      githubServer.name.toLowerCase().includes(searchLower) ||
      githubServer.description.toLowerCase().includes(searchLower)

    // Filter registry servers
    const filteredRegistry = searchLower
      ? registry.filter(
          (s) =>
            s.name.toLowerCase().includes(searchLower) ||
            s.description.toLowerCase().includes(searchLower) ||
            s.slug.toLowerCase().includes(searchLower)
        )
      : registry

    // Combine: GitHub first (if matches), then registry
    const combined = githubMatches
      ? [githubServer, ...filteredRegistry]
      : filteredRegistry

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer text-sm",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          aria-label={`MCP servers${connectedCount > 0 ? `, ${connectedCount} connected` : ""}`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <Plug className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          <span
            className={cn(
              isMobile
                ? "hidden @[16rem]/row1:inline"
                : "hidden @[32rem]:inline"
            )}
          >
            MCP
            {connectedCount > 0 && (
              <span className="ml-1 text-foreground/80">
                ({connectedCount})
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              isMobile
                ? "h-4 w-4 hidden @[16rem]/row1:block"
                : "h-3.5 w-3.5"
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0"
        align="start"
        side="bottom"
        sideOffset={8}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search MCP servers..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loadingRegistry && allServers.length === 0 ? (
              <div
                className="flex items-center justify-center py-6"
                role="status"
                aria-label="Loading MCP servers"
              >
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : allServers.length === 0 ? (
              <CommandEmpty>No servers found</CommandEmpty>
            ) : (
              allServers.map((s) => {
                const isGitHub = s.slug === GITHUB_QUALIFIED_NAME
                const connectedServer = connectedByName.get(s.slug)
                const isConn = !!connectedServer
                const hasError = connectedServer?.status === "error"
                const isPending = connectedServer?.status === "pending"
                const isBusy = isGitHub ? githubBusy : busySlug === s.slug
                const handleSelect = isGitHub
                  ? handleToggleGithub
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
                    {isGitHub ? (
                      <div
                        className="h-6 w-6 rounded bg-muted shrink-0 flex items-center justify-center"
                        aria-hidden="true"
                      >
                        <Github className="h-3.5 w-3.5 text-muted-foreground" />
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
                    {/* GitHub settings dropdown */}
                    {isGitHub && githubInstallationId && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          {/* Stop pointer events from bubbling so cmdk doesn't
                              treat this as a row select. */}
                          <button
                            type="button"
                            disabled={githubBusy}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onPointerUp={(e) => e.stopPropagation()}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
                            aria-label="GitHub settings"
                          >
                            <Settings className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
                          <DropdownMenuItem
                            onSelect={handleUninstallGithubApp}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            Uninstall app entirely
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
  )
}
