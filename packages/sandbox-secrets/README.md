# @background-agents/sandbox-secrets

Give Daytona sandboxes credentials they can *use* but never *read*.

## Why this exists

Daytona secrets already give you the primitive: a secret mounted on a sandbox shows up there only as an opaque placeholder (`dtn_secret_…`). Daytona's own egress proxy swaps in the real value on HTTPS requests to that secret's allowed hosts, so nothing inside the sandbox (`env`, `/proc/<pid>/environ`, `ps aux`, the agent's own transcript) can read the value itself — it can only be *used* through the proxy.

That primitive alone isn't enough to use safely. Daytona never returns a secret's value for you to check it against, has no expiry of its own, and only wires its proxy into a sandbox at boot if some secret is attached then. This package is the policy layer that fills those gaps:

- **Secrets are named after a hash of their value and allowed hosts**, so a rotated credential always gets a new secret — a stale one can never keep serving a value that's since changed.
- **Every use refreshes a "last used" stamp**, and a cleanup sweep deletes secrets nothing has touched recently — so this app's secrets don't accumulate forever, and nothing deletes one still in use.
- **A sandbox always keeps one harmless keepalive secret attached**, and gets restarted if it somehow still boots without its proxy wired — so attaching a secret for the first time always actually works.

Everything below is scoped to those three jobs — naming, expiry, and boot sequencing — plus a small convention for passing a secret reference through code that expects a plain credential string.

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSandbox, ensureSecret, secretName, setSecrets } from "@background-agents/sandbox-secrets"

const daytona = new Daytona()

// One secret per value (and the hosts it's restricted to), named after both,
// so it never needs updating — a changed value gets a new name.
const placeholder = await ensureSecret(daytona, () => process.env.OPENAI_API_KEY!, ["api.openai.com"])
const name = secretName(process.env.OPENAI_API_KEY!, ["api.openai.com"])

// Create a sandbox with secrets mounted from the start (avoids the restart a
// later first mount would need)...
const sandbox = await createSandbox(daytona, { snapshot: "..." }, { OPENAI_KEY: name })

// ...or set the mounted set on an existing one. Always replaces the whole
// set (plus an internal keepalive); pass `{}` to detach everything else.
await setSecrets(daytona, sandbox, { OPENAI_KEY: name })
await setSecrets(daytona, sandbox, {}) // detach OPENAI_KEY again

// Hand the placeholder straight to the process that needs it (e.g. as
// OPENAI_API_KEY in its env), so the mounted var can have a name no CLI reads.
```

### Rotating values

A rotating value's secret is already named after the value (`secretName`), so each new value gets a new name and placeholder; nothing needs pruning on rotation — a value that stops being used simply stops being touched, and ages out of `deleteStaleSecrets` like anything else unused.

### Cleanup

```ts
import { deleteStaleSecrets } from "@background-agents/sandbox-secrets"

// Delete every secret this app created that hasn't been used in a day.
await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000)

// Or just see what would be deleted, without deleting anything.
const wouldDelete = await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000, { dryRun: true })
```

## API

Every export below lives in `src/index.ts` — if you add or remove one, update this section in the same commit.

| Export | Purpose |
| --- | --- |
| `ensureSecret(daytona, value, hosts?)` | Create-or-find the secret for `value()` restricted to `hosts`, stamp it as used, return its placeholder. `value()` is only called when the secret turns out missing, so it can be a lazy/expensive/sensitive thunk. |
| `createSandbox(daytona, opts, secrets?)` | Create a sandbox with `secrets` (plus the keepalive) attached from the start, so it boots with its proxy wired — avoids the restart `setSecrets` would otherwise need on first mount. |
| `setSecrets(daytona, sandbox, secrets)` | Replace an existing sandbox's whole mounted set (plus the keepalive); pass `{}` to detach everything else. Restarts the sandbox only if it has secrets to attach and its proxy isn't wired. Refreshes every named secret's "last used" stamp. |
| `secretName(value, hosts?)` | The deterministic `bg_<hash>` name Daytona secrets are stored under for a given value and host restriction. |
| `secretLastUsedAt(secret)` | Reads a secret's last-used time back from Daytona's own `updatedAt`. |
| `stampLastUsed(at)` | The description text `ensureSecret`/`setSecrets` write to force Daytona to bump `updatedAt` — exported mainly for tests. |
| `deleteStaleSecrets(daytona, olderThanMs, opts?)` | Delete (or, with `{ dryRun: true }`, just list) every secret this app created whose last-used stamp is older than `olderThanMs`. |
| `toSecretMarker(name)` / `parseSecretMarker(value)` | Wrap/unwrap a secret name as a credential-shaped string, so a reference to a secret can flow through code that expects a plain credential value without the value ever being present. |
| `SECRET_PREFIX`, `SECRET_NAME_PATTERN` | The fixed prefix every secret this app creates is named with, and Daytona's secret-name validation pattern. |

The Daytona API key used needs secrets permissions.

## Guarantees and non-guarantees

**Guarantees:**
- Plaintext credential values never enter a sandbox — only opaque placeholders do.
- A rotated credential can never be served by a stale secret still holding the old value (secret names are derived from the value itself).
- Secrets this app creates don't accumulate indefinitely, and a sweep never deletes one that's still being used (each use refreshes its last-used stamp first).
- A sandbox that needs secrets for the first time gets its proxy wired, restarting if necessary — it never silently sends placeholders out unswapped.

**Does not guarantee:**
- Protection if the Daytona API key itself is compromised — whoever holds it can read/rotate every secret this app manages.
- Redaction in query strings — Daytona's proxy only swaps values in headers and Basic auth; a value placed in a query string causes the request to fail (502) rather than leak, but isn't silently fixed.
- Protection against a sandbox process that ignores `HTTPS_PROXY`/`NODE_EXTRA_CA_CERTS` (e.g. a non-conforming HTTP client, or Node's `fetch` without `NODE_USE_ENV_PROXY=1`) — such a request simply fails with the placeholder unswapped, rather than leaking, but it also won't work.

## Daytona proxy behavior, verified live

- The swap is done by an HTTPS proxy configured through env vars (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, …), and only intercepts the secret's hosts. A client that ignores those vars sends the placeholder as-is: it fails, but nothing leaks. Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1`.
- Swapped in headers and in Basic auth. **Not** in query strings (the proxy answers 502).
- The real value is scrubbed back to the placeholder in responses.
- A sandbox created **without** secrets must be restarted before attached ones work. Re-attaching after detaching everything does not need a restart, unless the sandbox was stopped and started while nothing was attached: the proxy is wired at boot only when some secret is attached, so it comes back without one (its `HTTPS_PROXY` empty). `setSecrets`/`createSandbox` always keep one harmless keepalive secret attached so that never happens.
- An in-place value update (`daytona.secret.update`) reaches mounted sandboxes in about 20s.
- The placeholder is the same in every sandbox; it only works where the secret is mounted.

## Development

```bash
npm run build -w @background-agents/sandbox-secrets
npm run test -w @background-agents/sandbox-secrets
```

`packages/web` loads the built `dist/`, so rebuild after changing `src/`.
