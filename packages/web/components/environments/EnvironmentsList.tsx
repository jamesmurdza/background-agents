"use client"

import { Boxes, Globe, Lock, FileCode, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { groupEnvironmentsByRepo } from "./helpers"
// Type-only: EnvironmentDTO's module imports @/lib/db/prisma.
import type { EnvironmentDTO } from "@/lib/environments"

interface EnvironmentsListProps {
  environments: EnvironmentDTO[]
  onSelect: (id: string) => void
}

function NetworkModeBadge({ env }: { env: EnvironmentDTO }) {
  return (
    <span className="inline-flex items-center gap-1">
      {env.networkMode === "full" ? (
        <>
          <Globe className="w-3.5 h-3.5" /> Full access
        </>
      ) : (
        <>
          <Lock className="w-3.5 h-3.5" /> Restricted
        </>
      )}
    </span>
  )
}

export function EnvironmentsList({ environments, onSelect }: EnvironmentsListProps) {
  if (environments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-muted-foreground p-6">
        <Boxes className="w-8 h-8" />
        <p className="text-sm">No environments yet.</p>
        <p className="text-xs">One is created automatically the first time you chat on a repo.</p>
      </div>
    )
  }

  const byRepo = groupEnvironmentsByRepo(environments)

  return (
    <div className="p-4 space-y-6">
      {Object.entries(byRepo).map(([repo, envs]) => (
        <section key={repo}>
          <h2 className="text-xs font-mono text-muted-foreground mb-2">{repo}</h2>

          {/* Mobile card layout */}
          <div className="space-y-2 md:hidden">
            {envs.map((env) => (
              <div
                key={env.id}
                onClick={() => onSelect(env.id)}
                className="rounded-lg border border-border bg-white/50 dark:bg-white/5 p-3 cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{env.name}</span>
                  {env.isDefault && (
                    <Star className="w-3 h-3 text-muted-foreground shrink-0" aria-label="Default" />
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <NetworkModeBadge env={env} />
                  <span>
                    {Object.keys(env.variables).length}{" "}
                    {Object.keys(env.variables).length === 1 ? "variable" : "variables"}
                  </span>
                  {env.hasSetupScript && (
                    <span className="inline-flex items-center gap-1">
                      <FileCode className="w-3.5 h-3.5" /> Setup script
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop list layout */}
          <div className="hidden md:block space-y-1">
            {envs.map((env) => (
              <button
                key={env.id}
                onClick={() => onSelect(env.id)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md border border-border hover:bg-accent transition-colors text-left cursor-pointer"
              >
                <span className={cn("text-sm font-medium", env.isDefault && "text-foreground")}>
                  {env.name}
                </span>
                {env.isDefault && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Default</span>
                )}
                <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                  <NetworkModeBadge env={env} />
                  <span>
                    {Object.keys(env.variables).length}{" "}
                    {Object.keys(env.variables).length === 1 ? "variable" : "variables"}
                  </span>
                  {env.hasSetupScript && (
                    <span className="inline-flex items-center gap-1">
                      <FileCode className="w-3.5 h-3.5" /> Setup script
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
