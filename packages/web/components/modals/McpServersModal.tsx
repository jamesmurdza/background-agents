"use client"

/**
 * McpServersModal — per-chat MCP server browser + connection manager.
 *
 * Two tabs:
 *   - Connected:  list of ChatMcpServer rows; disconnect removes the row
 *                 AND the upstream Smithery connection (best-effort)
 *   - Browse:     paginated, debounced search over Smithery's registry.
 *                 Click Connect:
 *                   - instant-connect server → row appears in Connected
 *                   - auth-required server   → open OAuth popup, then call
 *                                              /smithery-finalize on close
 */

import * as Dialog from "@radix-ui/react-dialog"
import {
  BadgeCheck,
  Loader2,
  Plug,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { focusChatPrompt } from "@/components/ui/modal-header"
import { cn } from "@/lib/utils"

// =============================================================================
// Types
// =============================================================================

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

type TabKey = "connected" | "browse"

interface McpServersModalProps {
  open: boolean
  onClose: () => void
  chatId: string
}

// =============================================================================
// Component
// =============================================================================

export function McpServersModal({
  open,
  onClose,
  chatId,
}: McpServersModalProps) {
  const [tab, setTab] = useState<TabKey>("connected")

  // Connected list
  const [connected, setConnected] = useState<ConnectedServer[]>([])
  const [loadingConnected, setLoadingConnected] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Registry browse
  const [registry, setRegistry] = useState<RegistryServer[]>([])
  const [loadingRegistry, setLoadingRegistry] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)

  const popupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Reset state when the modal opens.
  useEffect(() => {
    if (!open) return
    setTab("connected")
    setSearch("")
    setPage(1)
  }, [open])

  // =============================================================================
  // Fetchers
  // =============================================================================

  const loadConnected = useCallback(async () => {
    setLoadingConnected(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/mcp-servers`)
      if (res.ok) {
        const data = await res.json()
        setConnected(data.servers || [])
      }
    } catch (err) {
      console.error("[McpServersModal] loadConnected failed:", err)
    } finally {
      setLoadingConnected(false)
    }
  }, [chatId])

  const loadRegistry = useCallback(
    async (q: string, p: number, append: boolean) => {
      if (append) setLoadingMore(true)
      else setLoadingRegistry(true)
      try {
        const params = new URLSearchParams({ page: String(p) })
        if (q) params.set("search", q)
        const res = await fetch(`/api/mcp-registry?${params}`)
        if (res.ok) {
          const data = await res.json()
          setRegistry((prev) =>
            append ? [...prev, ...(data.servers || [])] : data.servers || []
          )
          setTotalPages(data.totalPages || 1)
        }
      } catch (err) {
        console.error("[McpServersModal] loadRegistry failed:", err)
      } finally {
        setLoadingRegistry(false)
        setLoadingMore(false)
      }
    },
    []
  )

  // Load connected list every time the modal opens.
  useEffect(() => {
    if (open) loadConnected()
  }, [open, loadConnected])

  // Load registry when entering Browse, then re-load on debounced search.
  useEffect(() => {
    if (!open || tab !== "browse") return
    setPage(1)
    const t = setTimeout(() => loadRegistry(search, 1, false), 300)
    return () => clearTimeout(t)
  }, [open, tab, search, loadRegistry])

  // Tear down any leftover popup-polling on unmount.
  useEffect(() => {
    return () => {
      if (popupTimerRef.current) clearInterval(popupTimerRef.current)
    }
  }, [])

  // =============================================================================
  // Actions
  // =============================================================================

  async function handleDisconnect(serverId: string) {
    if (deletingId) return
    setDeletingId(serverId)
    try {
      const res = await fetch(
        `/api/chats/${chatId}/mcp-servers/${serverId}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        setConnected((prev) => prev.filter((s) => s.id !== serverId))
      }
    } finally {
      setDeletingId(null)
    }
  }

  async function handleConnect(server: RegistryServer) {
    if (connectingSlug) return
    setConnectingSlug(server.slug)
    try {
      // Non-deployed servers don't expose a URL in the registry list — fetch
      // the detail endpoint to get one before we POST.
      let url = server.url
      if (!url) {
        const detailRes = await fetch(`/api/mcp-registry/${server.slug}`)
        if (!detailRes.ok) throw new Error("Failed to fetch server details")
        const detail = await detailRes.json()
        url = detail.url
        if (!url) throw new Error("Server does not expose a remote URL")
      }

      const res = await fetch(`/api/chats/${chatId}/mcp-servers`, {
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

      // Instant-connect (authless server) — refresh list, switch tab, done.
      if (data.connected) {
        setConnectingSlug(null)
        await loadConnected()
        setTab("connected")
        return
      }

      // Auth required: open Smithery's auth URL in a popup and poll for close.
      const popup = window.open(
        data.authUrl,
        "smithery-oauth",
        "width=600,height=700,scrollbars=yes"
      )
      if (!popup || popup.closed) {
        // Browser blocked the popup. Bail without leaving the spinner on.
        setConnectingSlug(null)
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
            `/api/chats/${chatId}/mcp-servers/${data.serverId}/smithery-finalize`,
            { method: "POST" }
          )
        } catch (err) {
          console.error("[McpServersModal] finalize failed:", err)
        }
        setConnectingSlug(null)
        await loadConnected()
        setTab("connected")
      }, 500)
    } catch (err) {
      console.error("[McpServersModal] handleConnect failed:", err)
      setConnectingSlug(null)
    }
  }

  // =============================================================================
  // Render
  // =============================================================================

  const tabs: { key: TabKey; label: string; icon: typeof Plug }[] = [
    { key: "connected", label: "Connected", icon: Plug },
    { key: "browse", label: "Browse", icon: Plus },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/15 backdrop-blur-[1px] transition-opacity duration-300",
            open ? "opacity-100" : "opacity-0"
          )}
        />
        <Dialog.Content
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            focusChatPrompt()
          }}
          className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl h-[560px] max-h-[80vh] bg-popover border border-border rounded-xl shadow-xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <Dialog.Title className="text-lg font-semibold">
              MCP Servers
            </Dialog.Title>
            <Dialog.Close
              className="flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="flex border-b border-border px-5">
            {tabs.map((t) => {
              const Icon = t.icon
              const isActive = tab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px cursor-pointer",
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              )
            })}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === "connected" && (
              <ConnectedView
                servers={connected}
                loading={loadingConnected}
                deletingId={deletingId}
                onDisconnect={handleDisconnect}
                onBrowse={() => setTab("browse")}
              />
            )}
            {tab === "browse" && (
              <BrowseView
                servers={registry}
                connectedSlugs={new Set(connected.map((s) => s.qualifiedName))}
                loading={loadingRegistry}
                loadingMore={loadingMore}
                search={search}
                onSearchChange={setSearch}
                connectingSlug={connectingSlug}
                onConnect={handleConnect}
                hasMore={page < totalPages}
                onLoadMore={() => {
                  const next = page + 1
                  setPage(next)
                  loadRegistry(search, next, true)
                }}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// =============================================================================
// Subviews
// =============================================================================

function ConnectedView({
  servers,
  loading,
  deletingId,
  onDisconnect,
  onBrowse,
}: {
  servers: ConnectedServer[]
  loading: boolean
  deletingId: string | null
  onDisconnect: (id: string) => void
  onBrowse: () => void
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-12 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }
  if (servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Plug className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground mb-4">
          No MCP servers connected for this chat yet.
        </p>
        <button
          onClick={onBrowse}
          className="rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 text-sm cursor-pointer"
        >
          Browse servers
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {servers.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 rounded-lg border border-border p-3"
        >
          {s.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={s.iconUrl}
              alt=""
              className="h-8 w-8 rounded shrink-0"
            />
          ) : (
            <div className="h-8 w-8 rounded bg-muted shrink-0 flex items-center justify-center">
              <Plug className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{s.displayName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {s.qualifiedName}
            </p>
            {s.status === "error" && s.lastError && (
              <p className="text-xs text-destructive mt-0.5">{s.lastError}</p>
            )}
            {s.status === "pending" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Awaiting authorization…
              </p>
            )}
          </div>
          <button
            onClick={() => onDisconnect(s.id)}
            disabled={deletingId === s.id}
            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Disconnect"
          >
            {deletingId === s.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      ))}
    </div>
  )
}

function BrowseView({
  servers,
  connectedSlugs,
  loading,
  loadingMore,
  search,
  onSearchChange,
  connectingSlug,
  onConnect,
  hasMore,
  onLoadMore,
}: {
  servers: RegistryServer[]
  connectedSlugs: Set<string>
  loading: boolean
  loadingMore: boolean
  search: string
  onSearchChange: (v: string) => void
  connectingSlug: string | null
  onConnect: (s: RegistryServer) => void
  hasMore: boolean
  onLoadMore: () => void
}) {
  return (
    <div>
      <div className="relative mb-3">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search MCP servers (e.g. exa, github, postgres)"
          className="pl-8 text-sm"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {loading ? (
        <div className="flex justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : servers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No servers found.
        </p>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => {
            const isConnected = connectedSlugs.has(s.slug)
            const isConnecting = connectingSlug === s.slug
            return (
              <div
                key={s.slug}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                {s.iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.iconUrl}
                    alt=""
                    className="h-8 w-8 rounded shrink-0"
                  />
                ) : (
                  <div className="h-8 w-8 rounded bg-muted shrink-0 flex items-center justify-center">
                    <Plug className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-medium truncate">{s.name}</p>
                    {s.verified && (
                      <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {s.description}
                  </p>
                  {s.useCount > 0 && (
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                      {s.useCount >= 1000
                        ? `${(s.useCount / 1000).toFixed(1).replace(/\.0$/, "")}k uses`
                        : `${s.useCount} uses`}
                    </p>
                  )}
                </div>
                {isConnected ? (
                  <span className="text-xs text-muted-foreground px-2">
                    Connected
                  </span>
                ) : (
                  <button
                    onClick={() => onConnect(s)}
                    disabled={isConnecting || !!connectingSlug}
                    className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer flex items-center gap-1"
                  >
                    {isConnecting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                    Connect
                  </button>
                )}
              </div>
            )
          })}
          {hasMore && (
            <button
              onClick={onLoadMore}
              disabled={loadingMore}
              className="w-full flex items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Load More"
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
