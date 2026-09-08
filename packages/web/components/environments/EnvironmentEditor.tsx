"use client"

import { useState, useEffect, useRef } from "react"
import { ArrowLeft, Save, Trash2, Copy, Star, Plus, Loader2 } from "lucide-react"
import { NetworkModeFields } from "./NetworkModeFields"
import { recordToEnvVars, envVarsToRecord } from "./helpers"
import {
  useUpdateEnvironmentMutation,
  useDeleteEnvironmentMutation,
  useCreateEnvironmentMutation,
  fetchEnvironmentUsage,
} from "@/lib/query/hooks/useEnvironmentsQuery"
import { ConfirmDialog } from "@/components/modals/ConfirmDialog"
import { Input } from "@/components/ui/input"
import type { EnvVar } from "@/lib/types"
// Type-only: EnvironmentDTO's module imports @/lib/db/prisma.
import type { EnvironmentDTO } from "@/lib/environments"

interface EnvironmentEditorProps {
  environment: EnvironmentDTO
  onBack: () => void
  onDeleted: () => void
  /** Navigate to the duplicated environment once it's created. */
  onDuplicated: (id: string) => void
}

function EnvVarRow({
  envVar,
  onChange,
  onDelete,
  autoFocus,
}: {
  envVar: EnvVar
  onChange: (updated: EnvVar) => void
  onDelete: () => void
  autoFocus?: boolean
}) {
  const keyRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      keyRef.current?.focus()
    }
  }, [autoFocus])

  return (
    <div className="flex items-center gap-2 py-1">
      <Input
        ref={keyRef}
        type="text"
        value={envVar.key}
        onChange={(e) => onChange({ ...envVar, key: e.target.value })}
        placeholder="KEY"
        className="flex-1 font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
      />
      <span className="text-muted-foreground">=</span>
      <Input
        type="password"
        value={envVar.value}
        onChange={(e) => onChange({ ...envVar, value: e.target.value })}
        placeholder="value"
        className="flex-1 font-mono text-sm"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="button"
        onClick={onDelete}
        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
        aria-label={`Remove ${envVar.key || "variable"}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * Usage-count fetch result for the delete confirmation.
 * - "idle": haven't asked yet (initial state; the Delete button must NOT be
 *   disabled here, or it could never be clicked to start a fetch at all).
 * - "loading": the /usage request is in flight; the Delete button is
 *   disabled so a fast double-click can't open two overlapping fetches.
 * - "unknown": the /usage request failed, distinct from a genuine 0, since
 *   the whole point of this number is telling the user what a destructive
 *   action will affect.
 */
type UsageState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "known"; chatCount: number }
  | { status: "unknown" }

export function EnvironmentEditor({ environment, onBack, onDeleted, onDuplicated }: EnvironmentEditorProps) {
  // No re-seed effect: EnvironmentsView keys this component by environment.id,
  // so switching environments mounts a fresh instance (fresh useState calls)
  // instead of reusing one whose state would need reconciling against props.
  // That also means a mutation's query-invalidation refetch (new environment
  // object, same id) never silently overwrites unsaved edits mid-session.
  const [name, setName] = useState(environment.name)
  const [variables, setVariables] = useState<EnvVar[]>(
    recordToEnvVars(environment.variables ?? {})
  )
  const [newVarId, setNewVarId] = useState<string | null>(null)
  const [setupScript, setSetupScript] = useState(environment.setupScript ?? "")
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [usage, setUsage] = useState<UsageState>({ status: "idle" })
  const [confirmPromote, setConfirmPromote] = useState(false)

  // Separate mutation instances for save vs. promote so their `isPending`
  // flags don't cross-contaminate each other's button (promoting default
  // shouldn't make the Save button read "Saving", and vice versa).
  const update = useUpdateEnvironmentMutation()
  const promote = useUpdateEnvironmentMutation()
  const remove = useDeleteEnvironmentMutation()
  const create = useCreateEnvironmentMutation()

  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync({
        id: environment.id,
        name,
        variables: envVarsToRecord(variables),
        setupScript: setupScript || null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save")
    }
  }

  const askDelete = async () => {
    // Await the usage count before opening the dialog. ConfirmDialog has no
    // disabled/loading affordance and auto-focuses its confirm button on
    // open, so opening it first and filling in the count afterward would
    // leave a window where an enabled, auto-focused Delete (reachable by a
    // single click or a single Enter keypress) fires before the count the
    // whole dialog exists to show has arrived. The Delete button in the
    // header is disabled for this same window so a second click can't start
    // an overlapping fetch, but that alone doesn't protect the dialog itself
    // once it's open, which is why the dialog must not open until we know
    // what to tell the user.
    setError(null)
    setUsage({ status: "loading" })
    try {
      const chatCount = await fetchEnvironmentUsage(environment.id)
      setUsage({ status: "known", chatCount })
    } catch {
      setUsage({ status: "unknown" })
    }
    setConfirmDelete(true)
  }

  const confirmDeleteNow = async () => {
    try {
      await remove.mutateAsync(environment.id)
      onDeleted()
    } catch (err) {
      // The delete confirmation closes itself immediately (see ConfirmDialog),
      // so a failure (e.g. "promote another environment to default first")
      // has to surface on the main editor, not inside the closed dialog.
      setError(err instanceof Error ? err.message : "Failed to delete")
    }
  }

  const confirmPromoteNow = async () => {
    setError(null)
    try {
      await promote.mutateAsync({ id: environment.id, isDefault: true })
    } catch (err) {
      // Same reasoning as confirmDeleteNow: ConfirmDialog closes itself
      // immediately regardless of the async result, so a failed promotion
      // (e.g. the P2002 race the API reports a specific message for) has to
      // surface on the main editor rather than vanish with the dialog.
      setError(err instanceof Error ? err.message : "Failed to make default")
    }
  }

  const duplicate = async () => {
    setError(null)
    try {
      const created = await create.mutateAsync({
        repo: environment.repo,
        name: `${environment.name} (copy)`,
        duplicateOf: environment.id,
      })
      onDuplicated(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate")
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <button
          onClick={onBack}
          aria-label="Back to environments"
          className="p-1 hover:bg-accent rounded-md transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-sm text-muted-foreground font-mono truncate">{environment.repo}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium truncate">{environment.name}</span>
        {environment.isDefault && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">Default</span>
        )}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {!environment.isDefault && (
            <button
              onClick={() => setConfirmPromote(true)}
              disabled={promote.isPending}
              className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-md border border-border hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
            >
              <Star className="w-3.5 h-3.5" /> Make default
            </button>
          )}
          <button
            onClick={duplicate}
            disabled={create.isPending}
            className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-md border border-border hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
          >
            <Copy className="w-3.5 h-3.5" /> Duplicate
          </button>
          <button
            onClick={askDelete}
            disabled={usage.status === "loading"}
            className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-md border border-border hover:bg-accent text-destructive transition-colors cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
          <button
            onClick={save}
            disabled={update.isPending || !name.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {update.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {update.isPending ? "Saving" : "Save"}
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mx-4 mt-3 px-3 py-2 text-sm rounded-md bg-destructive/10 text-destructive shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-6 p-4 overflow-y-auto">
        <div className="space-y-6">
          <section className="space-y-2">
            <label htmlFor="environment-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="environment-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="max-w-sm"
            />
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Network access</h3>
            <NetworkModeFields
              networkMode={environment.networkMode}
              allowedDomains={environment.allowedDomains}
            />
            <p className="text-xs text-muted-foreground">
              Network changes take effect on the next sandbox, not on chats that are already running.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">Environment variables</h3>
            <p className="text-xs text-muted-foreground">
              Available to the agent on every chat that uses this environment.
            </p>
            <button
              type="button"
              onClick={() => {
                const newVar: EnvVar = { id: crypto.randomUUID(), key: "", value: "" }
                setNewVarId(newVar.id)
                setVariables((prev) => [...prev, newVar])
              }}
              className="flex items-center gap-2 w-full py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Add variable
            </button>
            {variables.length > 0 && (
              <div className="space-y-0.5">
                {variables.map((envVar) => (
                  <EnvVarRow
                    key={envVar.id}
                    envVar={envVar}
                    onChange={(updated) =>
                      setVariables((prev) => prev.map((v) => (v.id === envVar.id ? updated : v)))
                    }
                    onDelete={() => setVariables((prev) => prev.filter((v) => v.id !== envVar.id))}
                    autoFocus={envVar.id === newVarId}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col min-h-0">
          <h3 className="text-sm font-medium mb-2">Setup script</h3>
          <p className="text-xs text-muted-foreground mb-2">
            Runs in the repo directory when a sandbox is created (not executed yet in this version
            of the app). Put secrets in environment variables above, not in this script: the script
            is stored unencrypted.
          </p>
          <textarea
            value={setupScript}
            onChange={(e) => setSetupScript(e.target.value)}
            spellCheck={false}
            placeholder={"#!/usr/bin/env bash\nset -euo pipefail\n\nnpm install"}
            className="flex-1 min-h-[300px] w-full px-3 py-2 text-sm font-mono rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${environment.name}"?`}
        description={
          usage.status === "idle" || usage.status === "loading"
            ? "Checking how many chats use this environment..."
            : usage.status === "unknown"
              ? "Could not determine how many chats use this environment. Deleting it will still move any that do to the repo's default on their next sandbox."
              : usage.chatCount > 0
                ? `${usage.chatCount} ${usage.chatCount === 1 ? "chat uses" : "chats use"} this environment and will fall back to the repo's default on their next sandbox.`
                : "No chats use this environment."
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDeleteNow}
      />

      <ConfirmDialog
        open={confirmPromote}
        onClose={() => setConfirmPromote(false)}
        title={`Make "${environment.name}" the default for ${environment.repo}?`}
        description="Every future chat on this repo that doesn't pin a specific environment will be built from this one from now on."
        confirmLabel="Make default"
        onConfirm={confirmPromoteNow}
      />
    </div>
  )
}
