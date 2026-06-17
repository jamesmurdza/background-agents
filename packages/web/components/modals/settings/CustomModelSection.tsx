"use client"

import { Server } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CREDENTIAL_KEYS, type CredentialId } from "@/lib/credentials"
import { SettingsRow, PasswordInput, MobileSectionHeader } from "./shared"

interface CustomModelSectionProps {
  isMobile: boolean
  credValues: Record<CredentialId, string>
  setCredValue: (id: CredentialId, value: string) => void
}

/** Fields rendered as masked password inputs (the secret ones). */
const SECRET_FIELDS = new Set<CredentialId>([
  "CUSTOM_MODEL_API_KEY",
  "CUSTOM_MODEL_AUTH_TOKEN",
])

/**
 * "Custom model" tab: point runs at a custom Anthropic-compatible endpoint
 * instead of the shared pool. Base URL plus at least one of API key / auth
 * token are required (the Claude CLI refuses to start with no auth). When
 * configured, a "Custom model" option appears in the chat model dropdown.
 */
export function CustomModelSection({
  isMobile,
  credValues,
  setCredValue,
}: CustomModelSectionProps) {
  const fields = CREDENTIAL_KEYS.filter((f) => f.group === "custom-model")

  const baseUrl = credValues["CUSTOM_MODEL_BASE_URL"]
  const apiKey = credValues["CUSTOM_MODEL_API_KEY"]
  const authToken = credValues["CUSTOM_MODEL_AUTH_TOKEN"]
  // A field counts as "present" whether it holds a typed value or the "***"
  // mask for an already-saved secret.
  const hasBaseUrl = !!baseUrl
  const hasAuth = !!apiKey || !!authToken
  const showAuthWarning = hasBaseUrl && !hasAuth

  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Server} label="Custom model" />}

      <p className="text-xs text-muted-foreground mb-2">
        Route runs to a custom Anthropic-compatible endpoint (your own key, a
        gateway, or a proxy) instead of the shared pool. Requires a Base URL and
        at least one of API key / Auth token. Select &ldquo;Custom model&rdquo;
        in the model dropdown to use it.
      </p>

      {fields.map((field) => {
        const value = credValues[field.id]

        if (field.multiline) {
          return (
            <SettingsRow
              key={field.id}
              label={field.label}
              description="Optional. Authorization, x-api-key and anthropic-version are ignored."
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

        if (SECRET_FIELDS.has(field.id)) {
          return (
            <SettingsRow key={field.id} label={field.label}>
              <PasswordInput
                value={value}
                onChange={(v) => setCredValue(field.id, v)}
                placeholder={field.placeholder}
              />
            </SettingsRow>
          )
        }

        // Non-secret single-line fields (Base URL, Model name).
        return (
          <SettingsRow key={field.id} label={field.label}>
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

      {showAuthWarning && (
        <p className="mt-3 text-xs text-destructive">
          Add an API key or an Auth token — the endpoint won&apos;t authenticate
          without one.
        </p>
      )}
    </div>
  )
}
