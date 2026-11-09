# @background-agents/sandbox-secrets

Keep credentials out of Daytona sandboxes by mounting [Daytona secrets](https://www.daytona.io/docs) instead of passing raw values.

A mounted secret shows up in the sandbox only as an opaque placeholder (`dtn_secret_…`). Daytona's egress proxy swaps in the real value on HTTPS requests to the secret's allowed hosts, so nothing in the sandbox (`env`, `/proc/<pid>/environ`, `ps aux`, the agent's own transcript) can read the value itself. While a secret is mounted, anything in the sandbox can still *use* the placeholder.

## How Daytona's swap behaves

Verified live (see `packages/web/scripts/verify-daytona-secrets.ts`):

- The swap is done by an HTTPS proxy configured through env vars (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, …), and only intercepts the secret's hosts. A client that ignores those vars sends the placeholder as-is: it fails, but nothing leaks. Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1`.
- Swapped in headers and in Basic auth. **Not** in query strings (the proxy answers 502).
- The real value is scrubbed back to the placeholder in responses.
- A sandbox created **without** secrets must be restarted before attached ones work. Re-attaching after detaching everything does not need a restart, unless the sandbox was stopped and started while nothing was attached: the proxy is wired at boot only when some secret is attached, so it comes back without one (its `HTTPS_PROXY` empty). `setSecrets` always keeps one harmless keepalive secret attached so that never happens.
- An in-place value update (`daytona.secret.update`) reaches mounted sandboxes in about 20s.
- The placeholder is the same in every sandbox; it only works where the secret is mounted.

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

`createSandbox` attaches the secrets at creation, so the sandbox boots with its proxy wired. `setSecrets` restarts the sandbox only when it has secrets to attach and the proxy is unwired (checked directly with `printenv HTTPS_PROXY` inside the sandbox), and stamps every named secret's "last used" time on every call.

### Rotating values

A rotating value's secret is already named after the value (`secretName`), so each new value gets a new name and placeholder; nothing needs pruning on rotation — a value that stops being used simply stops being touched, and ages out of {@link deleteStaleSecrets} like anything else unused.

### Cleanup

```ts
import { deleteStaleSecrets } from "@background-agents/sandbox-secrets"

// Delete every secret this app created that hasn't been used in a day.
await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000)
```

`ensureSecret` and `setSecrets` both stamp a secret's description with when it was last used (`Last used: <ISO time>`) on every call — never cached, always refreshed. Writing a fresh, always-different stamp is what forces Daytona to bump the secret's own `updatedAt`, which `secretLastUsedAt(secret)` reads back directly (a no-op update wouldn't bump it). `deleteStaleSecrets` lists every secret named with this package's fixed prefix and deletes the ones whose `updatedAt` is old enough; nothing else (sandbox labels, a database) is consulted.

`deleteSecrets(daytona, { prefix, keep })` removes a family of secrets (e.g. one user's stale keys); `forgetSecrets(names)` makes `ensureSecret` look again for names that may have been deleted by another process.

To pass a reference to a secret through code that expects a credential value, use `toSecretMarker(name)` / `parseSecretMarker(value)`.

The Daytona API key needs the secrets permissions.

## Development

```bash
npm run build -w @background-agents/sandbox-secrets
npm run test -w @background-agents/sandbox-secrets
```

`packages/web` loads the built `dist/`, so rebuild after changing `src/`.
