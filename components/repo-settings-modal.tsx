"use client"

import { cn } from "@/lib/utils"
import { X, Plus, Trash2, Loader2, Variable, AlertTriangle, Plug, ExternalLink, Search, CheckCircle2, XCircle, Clock, BadgeCheck } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import { Input } from "@/components/ui/input"

interface EnvVar {
  key: string
  value: string
}

interface McpServer {
  id: string
  slug: string
  name: string
  url: string
  iconUrl: string | null
  status: "pending" | "connected" | "expired" | "error"
  lastError: string | null
  createdAt: string
}

interface RegistryServer {
  slug: string
  name: string
  description: string
  iconUrl: string | null
  url: string | null
  toolCount: number
  requiresAuth: boolean
  useCases: string[]
  verified: boolean
  useCount: number
  isDeployed: boolean
}

type SettingsTab = "env-vars" | "mcp-servers"

interface RepoSettingsModalProps {
  open: boolean
  onClose: () => void
  repoId: string
  repoOwner: string
  repoName: string
  initialEnvVars?: Record<string, boolean>
  onEnvVarsUpdate?: () => void
}

export function RepoSettingsModal({
  open,
  onClose,
  repoId,
  repoOwner,
  repoName,
  initialEnvVars,
  onEnvVarsUpdate,
}: RepoSettingsModalProps) {
  // Tab state
  const [activeTab, setActiveTab] = useState<SettingsTab>("env-vars")

  // Environment variables state
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [keysToDelete, setKeysToDelete] = useState<Set<string>>(new Set())

  // MCP servers state
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [isLoadingServers, setIsLoadingServers] = useState(false)
  const [showRegistry, setShowRegistry] = useState(false)
  const [registryServers, setRegistryServers] = useState<RegistryServer[]>([])
  const [isLoadingRegistry, setIsLoadingRegistry] = useState(false)
  const [registrySearch, setRegistrySearch] = useState("")
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null)
  const [registryPage, setRegistryPage] = useState(1)
  const [registryTotalPages, setRegistryTotalPages] = useState(1)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // UI state
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<{ message: string; isError: boolean } | null>(null)

  // Load MCP servers
  const loadMcpServers = useCallback(async () => {
    setIsLoadingServers(true)
    try {
      const response = await fetch(`/api/repo/${repoId}/mcp-servers`)
      if (response.ok) {
        const data = await response.json()
        setMcpServers(data.servers || [])
      }
    } catch (err) {
      console.error("Failed to load MCP servers:", err)
    } finally {
      setIsLoadingServers(false)
    }
  }, [repoId])

  // Load registry servers
  const loadRegistry = useCallback(async (search: string = "", page: number = 1, append: boolean = false) => {
    if (append) {
      setIsLoadingMore(true)
    } else {
      setIsLoadingRegistry(true)
    }
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (search) params.set("search", search)
      const response = await fetch(`/api/mcp-registry?${params}`)
      if (response.ok) {
        const data = await response.json()
        if (append) {
          setRegistryServers((prev) => [...prev, ...(data.servers || [])])
        } else {
          setRegistryServers(data.servers || [])
        }
        setRegistryTotalPages(data.totalPages || 1)
      }
    } catch (err) {
      console.error("Failed to load registry:", err)
    } finally {
      setIsLoadingRegistry(false)
      setIsLoadingMore(false)
    }
  }, [])

  // Initialize state when modal opens
  useEffect(() => {
    if (open) {
      // Reset env vars
      const vars: EnvVar[] = initialEnvVars
        ? Object.keys(initialEnvVars).map((key) => ({ key, value: "" }))
        : []
      setEnvVars(vars)
      setKeysToDelete(new Set())
      setSaveStatus(null)

      // Load MCP servers
      loadMcpServers()
    }
  }, [open, initialEnvVars, loadMcpServers])

  // Load registry when showing
  useEffect(() => {
    if (showRegistry) {
      setRegistryPage(1)
      loadRegistry(registrySearch)
    }
  }, [showRegistry, loadRegistry, registrySearch])

  // Debounced registry search
  useEffect(() => {
    if (!showRegistry) return
    const timer = setTimeout(() => {
      setRegistryPage(1)
      loadRegistry(registrySearch)
    }, 300)
    return () => clearTimeout(timer)
  }, [registrySearch, showRegistry, loadRegistry])

  if (!open) return null

  // Environment variables handlers
  function handleAddEnvVar() {
    setEnvVars((prev) => [...prev, { key: "", value: "" }])
  }

  function handleRemoveEnvVar(index: number) {
    const varToRemove = envVars[index]
    if (varToRemove.key && initialEnvVars?.[varToRemove.key]) {
      setKeysToDelete((prev) => new Set(prev).add(varToRemove.key))
    }
    setEnvVars((prev) => prev.filter((_, i) => i !== index))
  }

  function handleEnvVarChange(index: number, field: "key" | "value", value: string) {
    setEnvVars((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  async function handleSaveEnvVars() {
    const keys = envVars.map((v) => v.key.trim()).filter(Boolean)
    const uniqueKeys = new Set(keys)
    if (keys.length !== uniqueKeys.size) {
      setSaveStatus({ message: "Duplicate environment variable keys", isError: true })
      return
    }

    const invalidKey = envVars.find((v) => v.key.trim() && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.key.trim()))
    if (invalidKey) {
      setSaveStatus({ message: `Invalid key name: ${invalidKey.key}`, isError: true })
      return
    }

    setIsSaving(true)
    setSaveStatus(null)

    try {
      const envVarsToSave: Record<string, string | null> = {}
      for (const { key, value } of envVars) {
        const trimmedKey = key.trim()
        const trimmedValue = value.trim()
        if (trimmedKey && trimmedValue) {
          envVarsToSave[trimmedKey] = trimmedValue
        }
      }
      for (const key of keysToDelete) {
        envVarsToSave[key] = null
      }

      const response = await fetch(`/api/repo/${repoId}/env-vars`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envVars: envVarsToSave }),
      })

      const data = await response.json()
      if (!response.ok) {
        setSaveStatus({ message: data.error || "Failed to save", isError: true })
        return
      }

      setSaveStatus({ message: "Settings saved", isError: false })
      onEnvVarsUpdate?.()
      setTimeout(() => onClose(), 1000)
    } catch {
      setSaveStatus({ message: "Failed to save settings", isError: true })
    } finally {
      setIsSaving(false)
    }
  }

  // MCP servers handlers
  async function handleConnectServer(server: RegistryServer) {
    setConnectingSlug(server.slug)

    try {
      // If no URL (non-deployed server), fetch details first
      let serverUrl = server.url
      if (!serverUrl) {
        const detailRes = await fetch(`/api/mcp-registry/${server.slug}`)
        if (!detailRes.ok) {
          throw new Error("Failed to fetch server details")
        }
        const detail = await detailRes.json()
        serverUrl = detail.url
        if (!serverUrl) {
          throw new Error("Server does not have a remote URL")
        }
      }

      // Start OAuth flow
      const params = new URLSearchParams({
        slug: server.slug,
        url: serverUrl,
        name: server.name,
        ...(server.iconUrl && { iconUrl: server.iconUrl }),
      })

      const response = await fetch(`/api/repo/${repoId}/mcp-servers/oauth?${params}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to start OAuth")
      }

      // Smithery server connected immediately (no OAuth needed)
      if (data.connected) {
        setConnectingSlug(null)
        loadMcpServers()
        setShowRegistry(false)
        return
      }

      // Open OAuth popup (works for both Smithery auth and standard MCP OAuth)
      const popup = window.open(
        data.authUrl,
        "mcp-oauth",
        "width=600,height=700,scrollbars=yes"
      )

      // Handle popup blocked by browser
      if (!popup || popup.closed) {
        setConnectingSlug(null)
        return
      }

      const isSmithery = !!data.smitheryConnect
      const serverId = data.serverId

      // Poll for popup close and refresh
      const checkPopup = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(checkPopup)

          // For Smithery connections, finalize after popup closes
          if (isSmithery && serverId) {
            try {
              await fetch(`/api/repo/${repoId}/mcp-servers/smithery-finalize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serverId }),
              })
            } catch (err) {
              console.error("Failed to finalize Smithery connection:", err)
            }
          }

          setConnectingSlug(null)
          loadMcpServers()
          setShowRegistry(false)
        }
      }, 500)
    } catch (err) {
      console.error("Failed to connect server:", err)
      setConnectingSlug(null)
    }
  }

  async function handleRemoveServer(serverId: string) {
    try {
      const response = await fetch(`/api/repo/${repoId}/mcp-servers/${serverId}`, {
        method: "DELETE",
      })
      if (response.ok) {
        setMcpServers((prev) => prev.filter((s) => s.id !== serverId))
      }
    } catch (err) {
      console.error("Failed to remove server:", err)
    }
  }

  const hasEnvChanges = envVars.some((v) => v.key.trim() && v.value.trim()) || keysToDelete.size > 0
  const connectedSlugs = new Set(mcpServers.map((s) => s.slug))

  function getStatusIcon(status: McpServer["status"]) {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
      case "pending":
        return <Clock className="h-3.5 w-3.5 text-yellow-500" />
      case "expired":
        return <Clock className="h-3.5 w-3.5 text-orange-500" />
      case "error":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-foreground">Repository Settings</h2>
            <p className="text-xs text-muted-foreground">
              {repoOwner}/{repoName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex cursor-pointer h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border px-4">
          <button
            onClick={() => setActiveTab("env-vars")}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer border-b-2 -mb-px transition-colors",
              activeTab === "env-vars"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Variable className="h-3.5 w-3.5" />
            Environment Variables
          </button>
          <button
            onClick={() => setActiveTab("mcp-servers")}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-xs font-medium cursor-pointer border-b-2 -mb-px transition-colors",
              activeTab === "mcp-servers"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Plug className="h-3.5 w-3.5" />
            MCP Servers
            {mcpServers.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {mcpServers.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 px-4 sm:px-5 py-4 overflow-y-auto flex-1">
          {activeTab === "env-vars" && (
            <>
              <p className="text-[11px] text-muted-foreground">
                Environment variables defined here will be injected into every sandbox created for this repository.
              </p>

              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  These variables will be visible to the AI agent running in the sandbox.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {envVars.map((envVar, index) => {
                  const isExisting = envVar.key && initialEnvVars?.[envVar.key]
                  return (
                    <div key={index} className="flex gap-2">
                      <Input
                        placeholder="KEY_NAME"
                        value={envVar.key}
                        onChange={(e) => handleEnvVarChange(index, "key", e.target.value.toUpperCase())}
                        className="h-8 flex-1 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
                        disabled={!!isExisting}
                      />
                      <Input
                        type="password"
                        placeholder={isExisting ? "••••••••" : "value"}
                        value={envVar.value}
                        onChange={(e) => handleEnvVarChange(index, "value", e.target.value)}
                        className="h-8 flex-1 bg-secondary border-border text-xs font-mono placeholder:text-muted-foreground/40"
                      />
                      <button
                        onClick={() => handleRemoveEnvVar(index)}
                        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}

                <button
                  onClick={handleAddEnvVar}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground w-fit"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add variable
                </button>
              </div>

              {envVars.length > 0 && (
                <p className="text-[10px] text-muted-foreground/70">
                  Changes take effect on the next message.
                </p>
              )}
            </>
          )}

          {activeTab === "mcp-servers" && !showRegistry && (
            <>
              <p className="text-[11px] text-muted-foreground">
                Connect MCP servers to give the AI agent access to external tools and services.
              </p>

              {isLoadingServers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : mcpServers.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-8 text-center">
                  <Plug className="h-8 w-8 text-muted-foreground/50" />
                  <div>
                    <p className="text-sm text-muted-foreground">No MCP servers connected</p>
                    <p className="text-xs text-muted-foreground/70">Browse the registry to add one</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {mcpServers.map((server) => (
                    <div
                      key={server.id}
                      className="flex items-center gap-3 rounded-lg border border-border bg-secondary/50 px-3 py-2.5"
                    >
                      {server.iconUrl ? (
                        <img
                          src={server.iconUrl}
                          alt={server.name}
                          className="h-6 w-6 rounded"
                          onError={(e) => {
                            e.currentTarget.style.display = "none"
                          }}
                        />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
                          <Plug className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{server.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{server.url}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(server.status)}
                        <button
                          onClick={() => handleRemoveServer(server.id)}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowRegistry(true)}
                className="flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 w-fit"
              >
                <Plus className="h-3.5 w-3.5" />
                Browse Registry
              </button>
            </>
          )}

          {activeTab === "mcp-servers" && showRegistry && (
            <>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowRegistry(false)}
                  className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  ← Back
                </button>
                <span className="text-xs text-muted-foreground">|</span>
                <span className="text-xs font-medium">MCP Server Registry</span>
              </div>

              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search servers..."
                  value={registrySearch}
                  onChange={(e) => setRegistrySearch(e.target.value)}
                  className="h-8 pl-8 bg-secondary border-border text-xs"
                />
              </div>

              {isLoadingRegistry ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : registryServers.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm text-muted-foreground">No servers found</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                  {registryServers.map((server) => {
                    const isConnected = connectedSlugs.has(server.slug)
                    const isConnecting = connectingSlug === server.slug

                    return (
                      <div
                        key={server.slug}
                        className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 px-3 py-2.5"
                      >
                        {server.iconUrl ? (
                          <img
                            src={server.iconUrl}
                            alt={server.name}
                            className="h-8 w-8 rounded shrink-0"
                            onError={(e) => {
                              e.currentTarget.style.display = "none"
                            }}
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded bg-muted shrink-0">
                            <Plug className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <p className="text-xs font-medium text-foreground">{server.name}</p>
                            {server.verified && (
                              <BadgeCheck className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground line-clamp-2">{server.description}</p>
                          {server.useCount > 0 && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                              {server.useCount >= 1000
                                ? `${(server.useCount / 1000).toFixed(1).replace(/\.0$/, "")}k uses`
                                : `${server.useCount} uses`}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {isConnected ? (
                            <span className="text-[10px] text-green-500 font-medium">Connected</span>
                          ) : (
                            <button
                              onClick={() => handleConnectServer(server)}
                              disabled={isConnecting}
                              className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {isConnecting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <ExternalLink className="h-3 w-3" />
                                  Connect
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {registryPage < registryTotalPages && (
                    <button
                      onClick={() => {
                        const nextPage = registryPage + 1
                        setRegistryPage(nextPage)
                        loadRegistry(registrySearch, nextPage, true)
                      }}
                      disabled={isLoadingMore}
                      className="flex items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer disabled:opacity-50"
                    >
                      {isLoadingMore ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        "Load More"
                      )}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <div className="flex items-center gap-2 text-xs">
            {isSaving && (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">Saving...</span>
              </>
            )}
            {saveStatus && !isSaving && (
              <span className={saveStatus.isError ? "text-destructive" : "text-green-500"}>
                {saveStatus.message}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={isSaving}
              className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {activeTab === "mcp-servers" ? "Done" : "Cancel"}
            </button>
            {activeTab === "env-vars" && (
              <button
                onClick={handleSaveEnvVars}
                disabled={isSaving || !hasEnvChanges}
                className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
