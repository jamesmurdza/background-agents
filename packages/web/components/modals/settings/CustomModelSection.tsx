"use client"

import { useState } from "react"
import { Server } from "lucide-react"
import { cn } from "@/lib/utils"
import { CREDENTIAL_KEYS, type CredentialId } from "@/lib/credentials"
import { MobileSectionHeader } from "./shared"
import { CustomEndpointFields } from "./CustomEndpointFields"

interface CustomModelSectionProps {
  isMobile: boolean
  credValues: Record<CredentialId, string>
  setCredValue: (id: CredentialId, value: string) => void
}

/** A custom-endpoint target: one credential group + the agent it drives. */
type CustomTarget = {
  group: "custom-model" | "custom-codex" | "custom-opencode"
  /** Label for the target selector. */
  label: string
  /** Per-target intro copy shown above the fields. */
  intro: React.ReactNode
}

/**
 * Targets a custom endpoint can drive. Adding a new agent (e.g. OpenCode) is a
 * matter of adding its credential group (web/lib/credentials.ts) and one entry
 * here — the fields and layout are shared.
 */
const CUSTOM_TARGETS: CustomTarget[] = [
  {
    group: "custom-model",
    label: "Anthropic",
    intro: (
      <>
        Route Claude Code runs to a custom Anthropic-compatible endpoint (your
        own key, a gateway, or a proxy) instead of the shared pool. Only a Base
        URL is required — add authentication (e.g. <code>x-api-key</code> or{" "}
        <code>Authorization</code>) in the Headers field. Select &ldquo;Custom
        model&rdquo; in the model dropdown to use it.
      </>
    ),
  },
  {
    group: "custom-codex",
    label: "Codex",
    intro: (
      <>
        Route Codex runs to a custom OpenAI-compatible endpoint (your own key, a
        gateway, or a proxy). Only a Base URL is required — add authentication
        (e.g. <code>Authorization: Bearer …</code>) in the Headers field. Select
        the Codex agent and pick &ldquo;Custom endpoint&rdquo; in the model
        dropdown to use it.
      </>
    ),
  },
  {
    group: "custom-opencode",
    label: "OpenCode",
    intro: (
      <>
        Route OpenCode runs to a custom OpenAI-compatible endpoint (your own key,
        a gateway, or a proxy). Base URL and Model ID are required — add
        authentication (e.g. <code>Authorization: Bearer …</code>) in the Headers
        field. Select the OpenCode agent and pick &ldquo;Custom endpoint&rdquo; in
        the model dropdown to use it.
      </>
    ),
  },
]

/** Whether any field in a target's group already holds a value. */
function targetHasValue(
  group: CustomTarget["group"],
  credValues: Record<CredentialId, string>
): boolean {
  return CREDENTIAL_KEYS.some((f) => f.group === group && credValues[f.id])
}

/**
 * "Custom model" tab: point a single agent at a custom, self-hosted, or proxied
 * endpoint. The Base URL / Model ID / Headers form is shared across agents — a
 * target selector picks which one it configures. Auth is always supplied through
 * the Headers field rather than a dedicated key.
 */
export function CustomModelSection({
  isMobile,
  credValues,
  setCredValue,
}: CustomModelSectionProps) {
  // Default to whichever target the user has already configured, else the first.
  const [activeGroup, setActiveGroup] = useState<CustomTarget["group"]>(
    () =>
      CUSTOM_TARGETS.find((t) => targetHasValue(t.group, credValues))?.group ??
      CUSTOM_TARGETS[0].group
  )

  const active = CUSTOM_TARGETS.find((t) => t.group === activeGroup) ?? CUSTOM_TARGETS[0]

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Server} label="Custom model" />}

      {/* Target selector — segmented control */}
      <div className="inline-flex gap-0.5 rounded-md bg-muted/40 p-0.5 mb-3">
        {CUSTOM_TARGETS.map((t) => {
          const isActive = t.group === activeGroup
          return (
            <button
              key={t.group}
              type="button"
              onClick={() => setActiveGroup(t.group)}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground mb-2">{active.intro}</p>

      <CustomEndpointFields
        group={active.group}
        credValues={credValues}
        setCredValue={setCredValue}
      />
    </div>
  )
}
