"use client"

import { Key, Check, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"
import {
  CREDENTIAL_KEYS,
  type CredentialId,
  type ProviderId,
} from "@/lib/credentials"
import type { LicenseDetectResult } from "@/lib/hooks/useElectron"
import {
  SettingsRow,
  PasswordInput,
  CopyCode,
  ToggleSwitch,
  MobileSectionHeader,
} from "./shared"

/** Which provider's API key field to highlight with a red outline. */
export type HighlightKey = ProviderId | null

interface ApiKeysSectionProps {
  isMobile: boolean
  credValues: Record<CredentialId, string>
  setCredValue: (id: CredentialId, value: string) => void
  highlightKey: HighlightKey | undefined
  setInputRef: (
    id: CredentialId
  ) => (el: HTMLInputElement | HTMLTextAreaElement | null) => void
  // Desktop license auto-detect — only meaningful when isDesktopApp is true.
  isDesktopApp: boolean
  licenseAutoDetectEnabled: boolean
  onAutoDetectToggle: (enabled: boolean) => void
  refreshLicenseDetect: () => void
  licenseDetectLoading: boolean
  licenseDetectResult: LicenseDetectResult | null
}

function renderHelpLink(href: string, text = "Get key") {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline"
    >
      {text}
    </a>
  )
}

/** Hint shown below the Claude credentials textarea when manual entry is active. */
function ClaudeCredentialsHint() {
  return (
    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
      <p>Leave empty to use the shared pool.</p>
      <p>
        Or sign in with <CopyCode text="claude auth login" />
      </p>
      <p>
        Then paste the output of{" "}
        <CopyCode text={'security find-generic-password -s "Claude Code-credentials" -w'} />
      </p>
    </div>
  )
}

/**
 * API keys settings. Each credential renders as one row — password input for
 * short values, textarea (with optional hints) for multiline ones like the
 * full Claude Code credentials JSON.
 *
 * On desktop, the Claude Code credentials field offers auto-detect from the
 * local keychain / credentials file with a toggle and a "refresh" button.
 */
export function ApiKeysSection({
  isMobile,
  credValues,
  setCredValue,
  highlightKey,
  setInputRef,
  isDesktopApp,
  licenseAutoDetectEnabled,
  onAutoDetectToggle,
  refreshLicenseDetect,
  licenseDetectLoading,
  licenseDetectResult,
}: ApiKeysSectionProps) {
  return (
    <div>
      {isMobile && <MobileSectionHeader icon={Key} label="API Keys" />}
      {CREDENTIAL_KEYS.filter((field) => field.group !== "custom-model").map((field) => {
        const isHighlighted =
          highlightKey === field.provider &&
          // Highlight only the first field for the matching provider.
          CREDENTIAL_KEYS.find((c) => c.provider === field.provider)?.id === field.id
        const value = credValues[field.id]
        const description = field.description ? (
          field.helpUrl ? (
            <>
              {field.description} {renderHelpLink(field.helpUrl, "Get one →")}
            </>
          ) : (
            field.description
          )
        ) : field.helpUrl ? (
          renderHelpLink(field.helpUrl)
        ) : undefined

        if (field.multiline) {
          // Special handling for CLAUDE_CODE_CREDENTIALS with auto-detect (desktop only)
          if (field.id === "CLAUDE_CODE_CREDENTIALS" && isDesktopApp) {
            const autoDetectActive = licenseAutoDetectEnabled && licenseDetectResult?.found
            const sourceLabel =
              licenseDetectResult?.source === "keychain"
                ? "macOS Keychain"
                : licenseDetectResult?.source === "file"
                ? "credentials file"
                : null

            return (
              <SettingsRow key={field.id} label={field.label} description={description} stacked>
                {/* Auto-detect toggle and status */}
                <div className="mb-3 p-3 rounded-md bg-muted/50 border border-border/50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <ToggleSwitch
                        checked={licenseAutoDetectEnabled}
                        onChange={onAutoDetectToggle}
                      />
                      <span className="text-sm font-medium">Auto-detect from Claude Code</span>
                    </div>
                    <button
                      type="button"
                      onClick={refreshLicenseDetect}
                      disabled={licenseDetectLoading || !licenseAutoDetectEnabled}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={cn("h-3 w-3", licenseDetectLoading && "animate-spin")} />
                      Refresh
                    </button>
                  </div>

                  {/* Status indicator */}
                  {licenseAutoDetectEnabled && (
                    <div className="text-xs">
                      {licenseDetectLoading ? (
                        <span className="text-muted-foreground">Checking for credentials...</span>
                      ) : licenseDetectResult?.found ? (
                        <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          Detected from {sourceLabel}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {licenseDetectResult?.error || "Not found - enter manually below"}
                        </span>
                      )}
                    </div>
                  )}

                  {!licenseAutoDetectEnabled && (
                    <p className="text-xs text-muted-foreground">
                      Enable to automatically use credentials from your local Claude Code installation.
                    </p>
                  )}
                </div>

                {/* Manual input — shown when auto-detect is off OR credentials not found */}
                {(!licenseAutoDetectEnabled || !licenseDetectResult?.found) && (
                  <>
                    <Textarea
                      ref={setInputRef(field.id) as (el: HTMLTextAreaElement | null) => void}
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
                    <ClaudeCredentialsHint />
                  </>
                )}

                {/* Show indication when auto-detected credentials are being used */}
                {autoDetectActive && (
                  <p className="text-xs text-muted-foreground">
                    Using auto-detected credentials. Toggle off to enter manually.
                  </p>
                )}
              </SettingsRow>
            )
          }

          // Default multiline handling (non-CLAUDE_CODE_CREDENTIALS or web app)
          return (
            <SettingsRow key={field.id} label={field.label} description={description} stacked>
              <Textarea
                ref={setInputRef(field.id) as (el: HTMLTextAreaElement | null) => void}
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
              {field.id === "CLAUDE_CODE_CREDENTIALS" && <ClaudeCredentialsHint />}
            </SettingsRow>
          )
        }

        return (
          <SettingsRow key={field.id} label={field.label} description={description}>
            <PasswordInput
              value={value}
              onChange={(v) => setCredValue(field.id, v)}
              placeholder={field.placeholder}
              highlight={isHighlighted}
              inputRef={setInputRef(field.id) as (el: HTMLInputElement | null) => void}
            />
          </SettingsRow>
        )
      })}
    </div>
  )
}
