"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CREDENTIAL_KEYS, type CredentialId } from "@/lib/credentials"
import { SettingsRow } from "./shared"

interface CustomEndpointFieldsProps {
  /** Which credential group's fields to render (one of the "custom-*" targets). */
  group: "custom-model" | "custom-codex" | "custom-opencode"
  credValues: Record<CredentialId, string>
  setCredValue: (id: CredentialId, value: string) => void
}

/**
 * Renders the Base URL / Model ID / Headers inputs for a custom-endpoint tab.
 * Shared by the Anthropic ("Custom model") and Codex ("Custom Codex") sections
 * so they stay visually identical — each section just supplies its own intro
 * copy and the credential group to pull fields from.
 */
export function CustomEndpointFields({
  group,
  credValues,
  setCredValue,
}: CustomEndpointFieldsProps) {
  const fields = CREDENTIAL_KEYS.filter((f) => f.group === group)

  return (
    <>
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
    </>
  )
}
