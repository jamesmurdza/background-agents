# @background-agents/sandbox-secrets

[Daytona secrets](https://www.daytona.io/docs/en/secrets/) let a sandbox use a credential without ever being able to read it — the sandbox only sees an opaque placeholder (`dtn_secret_…`), and Daytona's egress proxy swaps in the real value on requests to that secret's allowed hosts.

This package simplifies secret handling by abstracting away the lifecycle of a Daytona secret, including:
- Create-or-reuse a secret for a value in one call, instead of checking if it exists yourself
- Automatic naming by value and host, so a rotated credential never collides with the old one
- Automatic "last used" tracking and expiry, instead of manually deleting secrets you're done with
- Automatically keeping a secret attached so a sandbox's proxy stays on, instead of needing a reboot

Instead of managing a secret's ID, name, staleness, and the sandbox's proxy state yourself, you only need to call `ensureSecret` when you need a credential and `deleteStaleSecrets` on a schedule.

## Usage

Ask for a secret with `ensureSecret`, then attach it with `createSandbox` or `setSecrets`.

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

Secrets this package creates don't need manual cleanup either — run `deleteStaleSecrets` on a schedule (e.g. a daily cron) and anything nothing has used recently is removed automatically.

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
