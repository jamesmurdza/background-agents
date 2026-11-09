# @background-agents/sandbox-secrets

Give Daytona sandboxes credentials they can *use* but never *read*.

A secret mounted on a sandbox shows up there only as an opaque placeholder (`dtn_secret_…`); Daytona's egress proxy swaps in the real value on requests to that secret's allowed hosts, so nothing inside the sandbox can read it. This package adds what Daytona's raw API doesn't: secrets named after their value (so a rotation can't leave a stale one serving the old value), automatic expiry of unused secrets, and handling for Daytona's boot-time proxy quirk.

## Usage

```typescript
import { Daytona } from "@daytonaio/sdk"
import { createSandbox, ensureSecret, secretName, setSecrets } from "@background-agents/sandbox-secrets"

const daytona = new Daytona()

// One secret per value (and the hosts it's restricted to), named after both,
// so it never needs updating — a changed value gets a new name.
const placeholder = await ensureSecret(daytona, () => process.env.OPENAI_API_KEY!, ["api.openai.com"])
const name = secretName(process.env.OPENAI_API_KEY!, ["api.openai.com"])

// Create a sandbox with secrets mounted from the start...
const sandbox = await createSandbox(daytona, { snapshot: "..." }, { OPENAI_KEY: name })

// ...or set the mounted set on an existing one. Pass `{}` to detach everything.
await setSecrets(daytona, sandbox, { OPENAI_KEY: name })
```

```typescript
import { deleteStaleSecrets } from "@background-agents/sandbox-secrets"

// Delete every secret this app created that hasn't been used in a day.
await deleteStaleSecrets(daytona, 24 * 60 * 60 * 1000)
```

To pass a reference to a secret through code that expects a credential value, use `toSecretMarker(name)` / `parseSecretMarker(value)`.

See the JSDoc on each export in `src/` for details. The Daytona API key used needs secrets permissions.

## Development

```bash
npm run build -w @background-agents/sandbox-secrets
npm run test -w @background-agents/sandbox-secrets
```

`packages/web` loads the built `dist/`, so rebuild after changing `src/`.
