# ChatGPT subscription

Run the **Codex** agent on your own **ChatGPT Plus or Pro** plan instead of an OpenAI API key. You connect once in Settings, and every Codex run after that goes through your plan.

Runs on your subscription don't consume credits and aren't subject to the daily shared-pool limit, the same as bringing your own API key.

:::media type="image" file="codex-subscription-connected.png"
The ChatGPT Subscription row in Settings, connected.
:::

## Before you start

Device code login is **off by default** on personal ChatGPT accounts, and you have to turn it on first:

**ChatGPT → Settings → Security → Allow device code login**

If it's off, connecting fails and tells you to flip that switch. If your account is managed by a workspace, an admin can block device code login entirely, in which case use an OpenAI API key instead.

## Connect

Open **Settings → API keys** and find the **ChatGPT Subscription** row, then click **Connect**.

There's nothing to paste. We start a temporary sandbox and run the real `codex login --device-auth` inside it, so the sign-in is the same one the Codex CLI uses. Setting that up takes a moment before the code appears.

:::media type="image" file="codex-subscription-code.png"
The one-time code panel, with the verification link and the 15 minute expiry.
:::

You'll get a link and a one-time code:

1. Open **auth.openai.com/codex/device**
2. Sign in to ChatGPT if you aren't already
3. Enter the code, which is good for 15 minutes
4. Approve

The row flips to **Connected** on its own. You don't need to keep the tab open beyond approving.

> [!NOTE]
> OpenAI's device page warns you to cancel if a website or another person gave you the code. That warning exists for good reason. Only continue if **you** clicked Connect here and are looking at the code we just showed you.

## Use it

Pick any **Codex** model in a chat's model selector and send a message. That's it.

The connection applies to every Codex run on your account from then on, including chats you already had open and [scheduled jobs](#/jobs). There's no per-chat setting.

A few boundaries worth knowing:

| Situation | What happens |
|-----------|--------------|
| A Codex model | Runs on your ChatGPT plan |
| Any other agent (Claude, Gemini, OpenCode, ...) | Unaffected. A ChatGPT plan only works with Codex |
| A [custom endpoint](#/custom-endpoints) | Uses that endpoint's own auth, not your subscription |
| You also have an `OPENAI_API_KEY` saved | Codex prefers your subscription, so the key goes unused |

Your ChatGPT plan's own rate limits still apply. Agent runs consume them noticeably faster than typing in ChatGPT does.

## Reconnect and disconnect

The connection refreshes itself in the background and normally lasts indefinitely. If it ever expires, the row shows **Connection expired** and Codex models lock until you click **Reconnect**.

**Disconnect** removes the stored connection and revokes it with OpenAI. Codex then falls back to your OpenAI API key, or the models lock if you don't have one saved.

## How your account stays safe

OpenAI rotates your sign-in token every time it's refreshed. If that token were handed to a sandbox, the sandbox could rotate it and log you out of Codex on your own laptop.

So it never leaves the server. Sandboxes receive a short-lived access token and a placeholder in place of the real one, which means nothing running in a sandbox can rotate or revoke your grant. Connecting here does not sign you out anywhere else, and your local `codex` CLI keeps working exactly as before.

The connection is stored encrypted, and it's per-user. It is never shared with anyone else.

## If something goes wrong

| Message | What it means |
|---------|---------------|
| Device code login is off for your account | Turn it on in ChatGPT → Settings → Security, then try again |
| Your ChatGPT workspace admin has blocked device code login | Use an OpenAI API key instead |
| The code expired | Codes last 15 minutes. Start again for a new one |
| Signing in worked, but we couldn't save the connection | The approval went through but storing it failed. Nothing is connected. Try connecting again |
| The sign-in environment became unreachable | The temporary sandbox went away. Try again |

## Next

- Run Codex on a schedule → [Jobs](#/jobs)
- Point an agent at your own model API instead → [Custom endpoints](#/custom-endpoints)
