# @background-agents/sandbox-secrets

[Daytona secrets](https://www.daytona.io/docs/en/secrets/) let a sandbox use a credential without ever being able to read it. The sandbox sees an opaque placeholder (`dtn_secret_…`), and an egress proxy swaps in the real value in HTTP requests limited to that secret's allowed hosts.

This package makes the secrets management interface simpler and easier to use:
1. A secrets only needs a value and a domain list. (No name is required.)
2. Secrets are reused automatically if they already exist.
3. Secrets update instantly when the value changes (instead of being cached by name).
4. There is no need to delete secrets. They can be cleaned up when inactive.
5. The secrets proxy is always available and ready to use. (There is no reboot required when the first secret is added.)

In summary, secrets are identified _only_ by their value and list of allowed hosts. They're created automatically when you ask for them, and cleaned up on a schedule that you set up.

## Prerequisites

You need a Daytona API key with secrets permissions — this package creates, updates, lists, and deletes secrets in your Daytona organization on your behalf, so the key used must be allowed to manage them.

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

See the JSDoc on each export in `src/` for details.

## Development

```bash
npm run build -w @background-agents/sandbox-secrets
npm run test -w @background-agents/sandbox-secrets
```

`packages/web` loads the built `dist/`, so rebuild after changing `src/`.
