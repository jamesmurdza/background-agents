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
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
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

  // Load connected list + GitHub app status whenever the popover opens.
  useEffect(() => {
    if (open) {
      loadConnected()
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
      if (!res.ok) throw new Error(data.error || "Connect failed")

      if (data.connected) {
        setBusySlug(null)
        await loadConnectedFor(id)
        return
      }

      // Auth required: open Smithery's auth URL in a popup and poll for close.
      const popup = window.open(
        data.authUrl,
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
  const showGithubRow =
    !search.trim() || "github".includes(search.toLowerCase())
  const githubConnected = connectedByName.has(GITHUB_QUALIFIED_NAME)

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
          title="MCP servers"
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
            {showGithubRow && (
              <>
                <CommandGroup heading="Featured">
                  <CommandItem
                    value="__github__"
                    onSelect={handleToggleGithub}
                    disabled={githubBusy}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <div className="h-6 w-6 rounded bg-muted shrink-0 flex items-center justify-center">
                      <Github className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">GitHub</div>
                      <div className="text-xs text-muted-foreground truncate">
                        Issues, PRs, code search via our GitHub App
                      </div>
                    </div>
                    {githubInstallationId && (
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
                              <ExternalLink className="h-3.5 w-3.5" />
                              Manage repositories
                            </a>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={handleUninstallGithubApp}
                            className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded-sm text-destructive focus:bg-destructive/10 focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Uninstall app entirely
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {githubBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : githubConnected ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : null}
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {loadingRegistry && registry.length === 0 ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : registry.length === 0 ? (
              <CommandEmpty>No servers found</CommandEmpty>
            ) : (
              <CommandGroup heading="Servers">
                {registry.map((s) => {
                  const isConn = connectedByName.has(s.slug)
                  const isBusy = busySlug === s.slug
                  return (
                    <CommandItem
                      key={s.slug}
                      value={s.slug}
                      onSelect={() => handleToggleServer(s)}
                      disabled={isBusy}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      {s.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.iconUrl}
                          alt=""
                          className="h-6 w-6 rounded shrink-0"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded bg-muted shrink-0 flex items-center justify-center">
                          <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <div className="text-sm font-medium truncate">
                            {s.name}
                          </div>
                          {s.verified && (
                            <BadgeCheck className="h-3 w-3 text-blue-500 shrink-0" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {s.description}
                        </div>
                      </div>
                      {isBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : isConn ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
