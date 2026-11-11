"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ExternalLink, Loader2, Rocket, Trash2 } from "lucide-react"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { useNetlifySitesQuery, type NetlifySiteInfo } from "@/lib/query/hooks/useNetlifySitesQuery"
import { queryKeys } from "@/lib/query/keys"
import { MobileSectionHeader } from "./shared"

/** The user's Netlify sites linked to a GitHub repo, with a way to delete them. */
export function DeploymentsSection({ isMobile }: { isMobile: boolean }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useNetlifySitesQuery()
  const [confirming, setConfirming] = useState<NetlifySiteInfo | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function remove(site: NetlifySiteInfo) {
    setDeletingId(site.id)
    setError(null)
    try {
      const res = await fetch(`/api/netlify/sites/${site.id}`, { method: "DELETE" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? "Couldn't delete the site")
      await queryClient.invalidateQueries({ queryKey: queryKeys.netlify.sites() })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Rocket} label="Deployments" />}
      <p className="mb-3 text-xs text-muted-foreground">
        Repositories you deployed to Netlify. Netlify redeploys a site on every push to its branch.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !data?.connected ? (
        <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
          Connect Netlify under Integrations to deploy a repository.
        </div>
      ) : data.sites.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/60 py-8 text-center text-sm text-muted-foreground">
          No deployed sites yet.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {data.sites.map((site) => (
            <li key={site.id} className="flex items-center gap-3 rounded-md border border-border/40 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <a
                  href={site.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-medium text-primary hover:underline"
                >
                  {site.url.replace(/^https:\/\//, "")}
                </a>
                <div className="truncate text-xs text-muted-foreground">
                  {site.repo} · {site.branch}
                </div>
              </div>
              <a
                href={site.adminUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in Netlify"
                title="Open in Netlify"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => setConfirming(site)}
                disabled={deletingId === site.id}
                aria-label="Delete site"
                title="Delete site"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-destructive disabled:cursor-default"
              >
                {deletingId === site.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={() => confirming && remove(confirming)}
        title={`Delete ${confirming?.name ?? "site"}?`}
        description="This deletes the site from Netlify, and its deploy key and webhook from the repository."
        confirmLabel="Delete"
        variant="destructive"
        isMobile={isMobile}
      />
    </div>
  )
}
