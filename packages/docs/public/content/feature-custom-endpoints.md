# Custom endpoints

Custom endpoints let you point an agent at **your own, self-hosted, or proxied** model API instead of a built-in provider. Add one in Settings and it appears **by name in the model dropdown**, ready to use in any chat or job.

Use them for an internal gateway, an OpenRouter or other proxy, a self-hosted model, or a provider variant that isn't listed out of the box.

:::media type="gif" file="add-custom-endpoint.gif" duration="~30s"
Adding a custom endpoint in Settings — name, type, base URL, headers — then picking it from the model dropdown in a chat.
:::

## Add an endpoint

Open **Settings → Custom endpoints → Add endpoint** and fill in the form.

:::media type="image" file="custom-endpoint-form.png"
The custom-endpoint form: Name, Type, Base URL, Model, and Headers (where auth goes).
:::

### The fields

| Field | What to put |
|-------|-------------|
| **Name** | A label for the dropdown, e.g. "My proxy". Required. |
| **Type** | Which runtime the endpoint speaks: **Anthropic**, **Codex**, or **OpenCode**. |
| **Base URL** | The API base, e.g. `https://openrouter.ai/api/v1`. Required. |
| **Model** | The model id to send. Optional for Anthropic/Codex (uses the endpoint default); **required for OpenCode**, which addresses models as `<provider>/<model>`. |
| **Headers** | Auth and any custom headers, one per line — `Header-Name: value`. |

### The three types

- **Anthropic** — base URL like `https://api.anthropic.com`; header `x-api-key: sk-ant-…` (or `Authorization: Bearer <token>`).
- **Codex** — base URL like `https://api.openai.com/v1`; header `Authorization: Bearer sk-…`.
- **OpenCode** — base URL like `https://openrouter.ai/api/v1`; **model required** (e.g. `gpt-4o-mini`); header `Authorization: Bearer sk-…`.

## Use it

Save, then open any chat's model selector. Your endpoint is listed by name alongside the built-in models — select it and the agent runs against your API.

:::media type="image" file="endpoint-in-dropdown.png"
A saved custom endpoint appearing by name in the model dropdown, ready to select.
:::

## Security

Headers can carry secrets, so they're **encrypted at rest**; the other fields are stored as plaintext. Endpoints are per-user.

> [!WARNING]
> Put credentials only in the **Headers** field — never in the Base URL. When recording or screen-sharing this screen, blur the header values before publishing.

> [!NOTE]
> In production, credential encryption requires `ENCRYPTION_KEY` to be set. Without it the app refuses to store encrypted headers.

## Where this shines

- **Agent Battle** — enter a proxied or self-hosted model against the built-ins. See [Agent Battle](#/agent-battle).
- **Cost control** — route through a gateway that caches or rate-limits.
- **Compliance** — keep traffic on an internal endpoint you operate.

## Next

- Put a custom model up against the built-ins → [Agent Battle](#/agent-battle)
- Give your endpoint's agent extra tools → [MCP servers](#/mcp)
