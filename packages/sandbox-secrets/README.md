# @background-agents/sandbox-secrets

Keep credentials out of Daytona sandboxes by mounting [Daytona secrets](https://www.daytona.io/docs) instead of passing raw values.

A mounted secret shows up in the sandbox only as an opaque placeholder (`dtn_secret_…`). Daytona's egress proxy swaps in the real value on HTTPS requests to the secret's allowed hosts, so nothing in the sandbox (`env`, `/proc/<pid>/environ`, `ps aux`, the agent's own transcript) can read the value itself. While a secret is mounted, anything in the sandbox can still *use* the placeholder.

## How Daytona's swap behaves

Verified live (see `packages/web/scripts/verify-daytona-secrets.ts`):

- The swap is done by an HTTPS proxy configured through env vars (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`, …), and only intercepts the secret's hosts. A client that ignores those vars sends the placeholder as-is: it fails, but nothing leaks. Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1`.
- Swapped in headers and in Basic auth. **Not** in query strings (the proxy answers 502).
- The real value is scrubbed back to the placeholder in responses.
- A sandbox created **without** secrets must be restarted before attached ones work. Re-attaching after detaching everything does not need a restart, unless the sandbox was stopped and started while nothing was attached: the proxy is wired at boot only when some secret is attached, so it comes back without one (its `HTTPS_PROXY` empty). Keep one harmless secret pinned so that never happens.
- An in-place value update (`daytona.secret.update`) reaches mounted sandboxes in about 20s.
- The placeholder is the same in every sandbox; it only works where the secret is mounted.

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import {
  contentSecretName,
  ensureSecret,
  mountSecrets,
  releaseSecrets,
  secretsCreateParams,
  waitForPropagation,
} from "@background-agents/sandbox-secrets"

const daytona = new Daytona()
const OPTIONS = { label: "my-secrets" } // sandbox label that records what is mounted

// One secret per value, named after the value so it never needs updating.
const name = contentSecretName("openai_", process.env.OPENAI_API_KEY!)
const { placeholder } = await ensureSecret(daytona, {
  name,
  value: () => process.env.OPENAI_API_KEY!,
  hosts: ["api.openai.com"],
})

// Mount at creation (avoids the restart a later first mount would need)...
const sandbox = await daytona.create({ ...secretsCreateParams({ OPENAI_KEY: name }, OPTIONS) })

// ...or on an existing sandbox, then wait for the proxy before relying on it.
const mounted = await mountSecrets(sandbox, { OPENAI_KEY: name }, OPTIONS)
await waitForPropagation(mounted)

// Hand the placeholder straight to the process that needs it (e.g. as
// OPENAI_API_KEY in its env), so the mounted var can have a name no CLI reads.

// Detach (or shrink the set) when it should stop working.
await releaseSecrets(sandbox, OPTIONS)
```

The sandbox label stores the mounted set as `ENV:secret` pairs joined by `:` (or `none` when nothing is mounted). `mountSecrets` skips the API call when the label already matches, restarts a sandbox that has never had secrets (or, when the set changes, one whose `HTTPS_PROXY` is empty), and rolls back if it fails partway. `releaseSecrets` writes the label first so a failure can never leave a label claiming mounts that are gone.

### Rotating values

Name a rotating value's secret after the value too (`contentSecretName`), so each new value gets a new placeholder. When it rotates, prune with `deleteSecrets(daytona, { prefix, keepNewest: 2 })`: that keeps the newest two, so anything still using the previous value keeps working until it moves on.

### Pinned secrets

Some secrets should stay mounted between uses, for example a value a long-running dev server needs. Set `pinnedLabel` in the options and pass them as `mountSecrets`' fourth argument (`secretsCreateParams`' third). They are mounted alongside the others, and `releaseSecrets` keeps them by default. Passing an explicit `keep` to `releaseSecrets` records that set as the new pinned one.

```ts
const OPTIONS = { label: "my-secrets", pinnedLabel: "my-pinned-secrets" }
await mountSecrets(sandbox, { OPENAI_KEY: keyName }, OPTIONS, { STRIPE_KEY: stripeName })
await releaseSecrets(sandbox, OPTIONS) // STRIPE_KEY stays mounted
```

`deleteSecrets(daytona, { prefix, keep })` removes a family of secrets (e.g. one user's stale keys); `forgetSecrets(names)` makes `ensureSecret` look again for names that may have been deleted by another process.

`ensureSecret` also stamps a secret's description with when it was last used (`[used <ISO time>]`), at most once every `REVERIFY_MS` (6h) per process, which also re-checks that the secret still exists. `secretLastUsedAt(secret)` reads the stamp back (falling back to `createdAt`), so a sweep can delete secrets nothing has used for a while.

To pass a reference to a secret through code that expects a credential value, use `toSecretMarker(name)` / `parseSecretMarker(value)`.

The Daytona API key needs the secrets permissions.

## Development

```bash
npm run build -w @background-agents/sandbox-secrets
npm run test -w @background-agents/sandbox-secrets
```

`packages/web` loads the built `dist/`, so rebuild after changing `src/`.
