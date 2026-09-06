"use client"

import { Lock, Globe } from "lucide-react"
import { BASELINE_DOMAINS } from "@background-agents/common"

interface NetworkModeFieldsProps {
  networkMode: "full" | "restricted"
  allowedDomains: string[]
}

/**
 * Network access section of the environment editor.
 *
 * Restricted mode is NOT selectable right now: the installed
 * @daytonaio/sdk (0.170.0) has no domain-allowlist field, only
 * "networkBlockAll" and a CIDR-only "networkAllowList", neither of which can
 * express an allowed-hostnames list. Sandbox creation throws on restricted
 * mode (see buildSandboxCreateParams) and the environments API rejects
 * `networkMode: "restricted"` with a 400, so this component never lets a
 * user select it and never renders an editable domain list.
 *
 * When @daytonaio/sdk is upgraded past 0.170.0 to a version with a real
 * domain-allowlist field (0.185.0+):
 *   1. Remove the `disabled` prop and explanatory copy on the "Restricted"
 *      radio below.
 *   2. Restore an editable add/remove UI for `allowedDomains` (the baseline
 *      domains list below is read-only reference copy; it explains what
 *      restricted mode WILL allow once it's enforced, but was never meant to
 *      be editable itself).
 *   3. Delete the matching 400 checks in the environments API routes and the
 *      throw in buildSandboxCreateParams.
 */
export function NetworkModeFields({ networkMode, allowedDomains }: NetworkModeFieldsProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="networkMode"
            checked={networkMode === "full"}
            readOnly
            className="mt-1"
          />
          <span className="text-sm">
            <span className="font-medium inline-flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" /> Full access
            </span>
            <span className="block text-muted-foreground text-xs">
              The sandbox can reach any host. This is the only mode available right now.
            </span>
          </span>
        </label>

        <label
          className="flex items-start gap-2 cursor-not-allowed"
          aria-disabled="true"
        >
          <input
            type="radio"
            name="networkMode"
            checked={networkMode === "restricted"}
            disabled
            className="mt-1"
          />
          <span className="text-sm">
            <span className="font-medium inline-flex items-center gap-1.5 text-muted-foreground">
              <Lock className="w-3.5 h-3.5" /> Restricted (not available yet)
            </span>
            <span className="block text-muted-foreground text-xs">
              Restricted mode is not enforced by the installed Daytona SDK, so it cannot be
              selected. The SDK has no domain-allowlist field yet, only a block-all switch and a
              CIDR-only IP allowlist, neither of which can express an allowed-hostnames list. This
              will come back once the SDK adds that support.
            </span>
          </span>
        </label>
      </div>

      <div className="space-y-2 pl-6">
        <p className="text-xs text-muted-foreground mb-1">
          When restricted mode ships, these domains will always be allowed so the clone and the
          agent keep working:
        </p>
        <div className="flex flex-wrap gap-1">
          {BASELINE_DOMAINS.map((domain) => (
            <span
              key={domain}
              className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground"
            >
              <Lock className="w-3 h-3" />
              {domain}
            </span>
          ))}
        </div>
        {allowedDomains.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground mb-1 pt-1">
              Additional domains saved on this environment (inert until restricted mode is
              enforced):
            </p>
            <div className="flex flex-wrap gap-1">
              {allowedDomains.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground"
                >
                  {domain}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
