"use client"

import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Rocket, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { connectNetlify } from "@/lib/netlify-connect"
import { queryKeys } from "@/lib/query/keys"
import { useNetlifySitesQuery } from "@/lib/query/hooks/useNetlifySitesQuery"
import { Input } from "@/components/ui/input"
import { DialogLabel, DialogReadonlyField } from "@/components/ui/dialog-parts"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { PopoverHeader, PopoverPrimaryButton } from "@/components/ui/popover-parts"

// =============================================================================
// DeployButton — deploy the chat's repo to Netlify from a popover anchored to
// the header icon. Mirrors ShareButton's trigger + popover shape.
// =============================================================================

interface DeployInfo {
  connected: boolean
  branch: string
  suggestedName: string
  unmerged: boolean
  site?: { name: string; url: string; adminUrl: string } | null
  deploy?: { state: string; error: string | null } | null
}

/** A linked site whose first deploy hasn't shown up yet counts as building. */
const isBuilding = (info: DeployInfo) =>
  !!info.site && (!info.deploy || (info.deploy.state !== "ready" && info.deploy.state !== "error"))

interface DeployButtonProps {
  chatId: string
  repo: string
  branch: string
}

export function DeployButton({ chatId, repo, branch }: DeployButtonProps) {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  // Known before the popover is opened, so the trigger can show green immediately.
  const { data: sitesData } = useNetlifySitesQuery()
  const knownSite = sitesData?.sites.find((s) => s.repo === repo && s.branch === branch)
  const [info, setInfo] = useState<DeployInfo | null>(null)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped after connecting or deploying to load the status again.
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async (): Promise<DeployInfo> => {
    const res = await fetch(`/api/chats/${chatId}/netlify`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Couldn't load the Netlify status")
    return data
  }, [chatId])

  // Load when opened; while a deploy is building, check again every few seconds.
  useEffect(() => {
    if (!open || !chatId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        const data = await load()
        if (cancelled) return
        setInfo(data)
        setName((current) => current || data.suggestedName)
        if (isBuilding(data)) timer = setTimeout(tick, 5000)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, chatId, load, reloadKey])

  // Start fresh each time the popover opens.
  useEffect(() => {
    if (open) return
    setInfo(null)
    setName("")
    setError(null)
  }, [open])

  async function connect() {
    setBusy(true)
    await connectNetlify()
    setBusy(false)
    setReloadKey((k) => k + 1)
  }

  async function deploy() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chats/${chatId}/netlify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Deploy failed")
      setReloadKey((k) => k + 1)
      // The header's deploy button turns green once the repo has a site.
      queryClient.invalidateQueries({ queryKey: queryKeys.netlify.sites() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const building = !!info && isBuilding(info)
  // The first deploy reads build settings from the base branch, so the
  // chat's changes need to be merged before it.
  const disabled = !info || building || (info.connected && !info.site && (!name.trim() || info.unmerged))
  const action = info && !info.connected ? connect : deploy
  const actionLabel = info && !info.connected ? "Connect Netlify" : info?.site ? "Redeploy" : "Deploy"
  const site = info?.site ?? knownSite
  const title = site ? `Deployed: ${site.url.replace(/^https:\/\//, "")}` : "Deploy to Netlify"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer",
            site
              ? "text-green-500 hover:bg-green-500/10"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
          title={title}
          aria-label={title}
        >
          <Rocket className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[28rem]">
        <PopoverHeader icon={<Rocket className="h-4 w-4 text-muted-foreground" />} title="Deploy to Netlify" />

        {!info && !error && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {info && !info.connected && (
          <p className="mt-2 text-xs text-muted-foreground">Connect Netlify to deploy this repo.</p>
        )}

        {info?.connected && (
          <div className="mt-3 space-y-3">
            <div>
              <DialogLabel>Site</DialogLabel>
              {info.site ? (
                <DialogReadonlyField>
                  <a href={info.site.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {info.site.url.replace(/^https:\/\//, "")}
                  </a>
                </DialogReadonlyField>
              ) : (
                <div className="flex items-center gap-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} aria-label="Site name" />
                  <span className="text-muted-foreground shrink-0 text-xs">.netlify.app</span>
                </div>
              )}
            </div>

            <div>
              <DialogLabel>Branch</DialogLabel>
              <DialogReadonlyField>{info.branch}</DialogReadonlyField>
              {info.unmerged && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Type /merge to put this chat&apos;s changes on {info.branch}.
                </p>
              )}
            </div>

            {info.site && (
              <div className="flex items-center gap-1.5 text-xs">
                {building && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                <span className={info.deploy?.state === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {building
                    ? "Deploying…"
                    : info.deploy?.state === "ready"
                      ? "Live"
                      : `Failed: ${info.deploy?.error ?? "see the deploy log"}`}
                </span>
                <a href={`${info.site.adminUrl}/deploys`} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0 text-primary hover:underline">
                  View in Netlify
                </a>
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <PopoverPrimaryButton onClick={action} disabled={disabled} loading={busy}>
          {actionLabel}
        </PopoverPrimaryButton>
      </PopoverContent>
    </Popover>
  )
}
