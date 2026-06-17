"use client"

import { Server } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CREDENTIAL_KEYS, type CredentialId } from "@/lib/credentials"
import { SettingsRow, MobileSectionHeader } from "./shared"

interface CustomModelSectionProps {
  isMobile: boolean
  credValues: Record<CredentialId, string>
  setCredValue: (id: CredentialId, value: string) => void
}

/**
 * "Custom model" tab: point runs at a custom Anthropic-compatible endpoint
 * instead of the shared pool. Only the Base URL is required; authentication is
 * supplied through the Headers field (x-api-key or Authorization). When a Base
 * URL is set, a "Custom model" option appears in the chat model dropdown.
 */
export function CustomModelSection({
  isMobile,
  credValues,
  setCredValue,
}: CustomModelSectionProps) {
  const fields = CREDENTIAL_KEYS.filter((f) => f.group === "custom-model")

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Server} label="Custom model" />}

      <p className="text-xs text-muted-foreground mb-2">
        Route runs to a custom Anthropic-compatible endpoint (your own key, a
        gateway, or a proxy) instead of the shared pool. Only a Base URL is
        required — add authentication (e.g. <code>x-api-key</code> or{" "}
        <code>Authorization</code>) in the Headers field. Select &ldquo;Custom
        model&rdquo; in the model dropdown to use it.
      </p>

      {fields.map((field) => {
        const value = credValues[field.id]
        const label = field.required ? (
          <>
            {field.label} <span className="text-destructive">*</span>
          </>
        ) : (
          field.label
        )

        if (field.multiline) {
          return (
            <SettingsRow
              key={field.id}
              label={label}
              description={field.description}
              stacked
            >
              <Textarea
                value={value}
                onChange={(e) => setCredValue(field.id, e.target.value)}
                placeholder={field.placeholder}
                rows={3}
                autoComplete="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                className="font-mono text-xs"
              />
            </SettingsRow>
          )
        }

        return (
          <SettingsRow key={field.id} label={label} description={field.description}>
            <Input
              value={value}
              onChange={(e) => setCredValue(field.id, e.target.value)}
              placeholder={field.placeholder}
              autoComplete="off"
              spellCheck={false}
              className="w-56 font-mono"
            />
          </SettingsRow>
        )
      })}
    </div>
  )
}
