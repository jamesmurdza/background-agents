"use client"

import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Rocket, Loader2 } from "lucide-react"
import { BaseDialog } from "@/components/modals/BaseDialog"
import { DialogLabel, DialogReadonlyField, DialogFooter, dialogIconClass } from "@/components/ui/dialog-parts"
import { Input } from "@/components/ui/input"
import { connectNetlify } from "@/lib/netlify-connect"
import { queryKeys } from "@/lib/query/keys"
import { cn } from "@/lib/utils"

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

interface NetlifyDeployDialogProps {
  open: boolean
  onClose: () => void
  chatId: string | null
  isMobile?: boolean
}

/**
 * Deploy the current chat's repo to Netlify. The first deploy creates a site
 * linked to the repo's base branch; after that Netlify rebuilds it on every
 * push, so this dialog mostly shows the site and its latest deploy.
 */
export function NetlifyDeployDialog({ open, onClose, chatId, isMobile = false }: NetlifyDeployDialogProps) {
  const queryClient = useQueryClient()
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

  // Start fresh each time the dialog opens.
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

  const textSize = isMobile ? "text-sm" : "text-xs"
  const building = !!info && isBuilding(info)

  return (
    <BaseDialog
      open={open}
      onClose={onClose}
      title="Deploy to Netlify"
      icon={<Rocket className={dialogIconClass(isMobile)} />}
      isMobile={isMobile}
    >
      <div className="space-y-5">
        {!info && !error && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {info && !info.connected && (
          <p className={cn("text-muted-foreground", isMobile ? "text-base" : "text-sm")}>
            Connect Netlify to deploy this repo.
          </p>
        )}

        {info?.connected && (
          <>
            <div>
              <DialogLabel isMobile={isMobile}>Site</DialogLabel>
              {info.site ? (
                <DialogReadonlyField isMobile={isMobile}>
                  <a href={info.site.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {info.site.url.replace(/^https:\/\//, "")}
                  </a>
                </DialogReadonlyField>
              ) : (
                <div className="flex items-center gap-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} aria-label="Site name" />
                  <span className={cn("text-muted-foreground shrink-0", textSize)}>.netlify.app</span>
                </div>
              )}
            </div>

            <div>
              <DialogLabel isMobile={isMobile}>Branch</DialogLabel>
              <DialogReadonlyField isMobile={isMobile}>{info.branch}</DialogReadonlyField>
              {info.unmerged && (
                <p className={cn("text-muted-foreground mt-1", textSize)}>
                  Type /merge to put this chat&apos;s changes on {info.branch}.
                </p>
              )}
            </div>

            {info.site && (
              <div className={cn("flex items-center gap-1.5", textSize)}>
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

            {info.site && (
              <p className={cn("text-muted-foreground", textSize)}>
                Set its environment variables in Environment Variables → Deployment.
              </p>
            )}
          </>
        )}

        {error && <p className={cn("text-destructive", textSize)}>{error}</p>}

        <DialogFooter
          onCancel={onClose}
          onAction={info && !info.connected ? connect : deploy}
          actionLabel={info && !info.connected ? "Connect Netlify" : info?.site ? "Redeploy" : "Deploy"}
          // The first deploy reads build settings from the base branch, so the
          // chat's changes need to be merged before it.
          disabled={!info || building || (info.connected && !info.site && (!name.trim() || info.unmerged))}
          loading={busy}
          isMobile={isMobile}
          variant={info && !info.connected ? "primary" : "success"}
        />
      </div>
    </BaseDialog>
  )
}
