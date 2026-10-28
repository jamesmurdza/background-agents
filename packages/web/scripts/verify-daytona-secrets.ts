/**
 * Phase 0 spike: how Daytona secrets actually behave, before every agent and
 * credential is built on them (see lib/server/shared-pool-secrets for the
 * shared pools that already are).
 *
 * Creates throwaway sandboxes (label `ba-verify`) and secrets (`ba_verify_*`)
 * in the configured Daytona org, and deletes both on exit. Real provider keys
 * are only copied for OPENCODE_API_KEY and GEMINI_API_KEY; every other
 * provider gets a dummy value, so a CLI "passes" when the provider rejects the
 * key (it accepted the placeholder, trusted the proxy and reached the API).
 *
 *   npx tsx scripts/verify-daytona-secrets.ts [proxy] [restart] [limits] [cli] [--out file.json]
 */
import { config } from "dotenv"
import { createHash, randomBytes } from "node:crypto"
import { writeFileSync } from "node:fs"
import { Daytona, type Sandbox } from "@daytonaio/sdk"
import { createSession, type Event } from "@background-agents/sdk"
import { agentToProvider, getEnvForModel, type Agent, type Credentials } from "@background-agents/common"
import { getActiveSnapshotName } from "@background-agents/sandbox-image"

config({ path: ".env" })
config({ path: ".env.local", override: true })

const RUN = randomBytes(3).toString("hex")
const PREFIX = `ba_verify_${RUN}`
const ECHO_HOST = "httpbin.org"
const OTHER_ECHO_HOST = "postman-echo.com"

// The key needs the secrets permissions; VERIFY_DAYTONA_API_KEY lets the spike
// use a different key from the app's.
const daytona = new Daytona(
  process.env.VERIFY_DAYTONA_API_KEY ? { apiKey: process.env.VERIFY_DAYTONA_API_KEY } : undefined
)
const secretIds = new Map<string, string>()
const sandboxes: Sandbox[] = []
/** Real key values, scrubbed from anything printed. */
const realValues: string[] = []

interface Result { section: string; check: string; result: string; detail?: string }
const results: Result[] = []

function scrub(text: string): string {
  let out = text
  for (const value of realValues) out = out.split(value).join("<real-key>")
  return out
}

function record(section: string, check: string, result: boolean | string, detail = "") {
  const r = typeof result === "boolean" ? (result ? "YES" : "NO") : result
  const clean = scrub(detail).replace(/\s+/g, " ").slice(0, 400)
  results.push({ section, check, result: r, detail: clean })
  console.log(`[${section}] ${check}: ${r}${clean ? ` — ${clean}` : ""}`)
}

function randomValue(label: string): string {
  return `ba-verify-${label}-${randomBytes(8).toString("hex")}`
}

async function makeSecret(label: string, value: string, hosts?: string[]) {
  const name = `${PREFIX}_${label}`
  const secret = await daytona.secret.create({
    name,
    value,
    hosts,
    description: "Phase 0 secrets spike (scripts/verify-daytona-secrets.ts), safe to delete",
  })
  secretIds.set(name, secret.id)
  return { name, id: secret.id, placeholder: secret.placeholder }
}

async function makeSandbox(secrets?: Record<string, string>): Promise<Sandbox> {
  const sandbox = await daytona.create({
    snapshot: await getActiveSnapshotName(daytona),
    labels: { "ba-verify": RUN },
    autoStopInterval: 15,
    autoDeleteInterval: 30,
    secrets,
  })
  sandboxes.push(sandbox)
  return sandbox
}

async function sh(sandbox: Sandbox, command: string, timeout = 60): Promise<string> {
  const res = await sandbox.process.executeCommand(command, undefined, undefined, timeout)
  return (res.result ?? "").trim()
}

/** Polls until `check` is true; returns the elapsed ms, or null on timeout. */
async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs = 1500): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if (await check()) return Date.now() - start
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ─── proxy: where the placeholder is swapped ─────────────────────────────────
//
// Echo servers can't show the swap: the proxy rewrites the real value back to
// the placeholder in responses. So every check here reads a status code that
// only the real value can produce instead: Gemini's free model list (200 only
// with a valid key) and httpbin's /basic-auth/<user>/<password> (200 only when
// the password matches).

const GEMINI_HOST = "generativelanguage.googleapis.com"
const GEMINI_MODELS = `https://${GEMINI_HOST}/v1beta/models`

function httpStatus(sandbox: Sandbox, args: string, url: string): Promise<string> {
  return sh(sandbox, `curl -s -o /dev/null -w '%{http_code}' --max-time 20 ${args} '${url}'`)
}

interface ProxyContext {
  sandbox: Sandbox
  key: string
  gemini: Awaited<ReturnType<typeof makeSecret>>
  basic: Awaited<ReturnType<typeof makeSecret>>
  basicValue: string
}

/** Whether a Gemini request carrying `placeholder` arrived with the real key. */
async function geminiSwapped(sandbox: Sandbox, placeholder: string): Promise<boolean> {
  return (await httpStatus(sandbox, `-H 'x-goog-api-key: ${placeholder}'`, GEMINI_MODELS)) === "200"
}

const NODE_FETCH = `node -e "fetch('${GEMINI_MODELS}',{headers:{'x-goog-api-key':process.env.BA_VERIFY_GEMINI}}).then(r=>console.log(r.status)).catch(e=>console.log('ERR',e.cause?.code||e.message))"`
const PYTHON_FETCH = [
  `python3 -c "import urllib.request,urllib.error,os`,
  `req=urllib.request.Request('${GEMINI_MODELS}',headers={'x-goog-api-key':os.environ['BA_VERIFY_GEMINI']})`,
  `try: print(urllib.request.urlopen(req).status)`,
  `except urllib.error.HTTPError as e: print(e.code)`,
  `except Exception as e: print('ERR', e)" 2>&1`,
].join("\n")

async function proxySection(): Promise<ProxyContext | undefined> {
  const S = "proxy"
  const key = process.env.GEMINI_API_KEY?.split(",")[0]?.trim()
  if (!key) {
    record(S, "GEMINI_API_KEY available (the swap oracle)", false)
    return undefined
  }
  realValues.push(key)
  const gemini = await makeSecret("gemini", key, [GEMINI_HOST])
  const basicValue = randomValue("basic")
  const basic = await makeSecret("basic", basicValue, [ECHO_HOST])
  const sandbox = await makeSandbox({ BA_VERIFY_GEMINI: gemini.name, BA_VERIFY_BASIC: basic.name })
  const ctx = { sandbox, key, gemini, basic, basicValue }

  const envValue = await sh(sandbox, `printf %s "$BA_VERIFY_GEMINI"`)
  record(S, "mounted env var holds the API placeholder", envValue === gemini.placeholder, `env=${envValue} api=${gemini.placeholder}`)

  const plain = await httpStatus(sandbox, `-H 'x-goog-api-key: ${randomValue("plain")}'`, GEMINI_MODELS)
  const realDirect = await httpStatus(sandbox, `-H 'x-goog-api-key: ${key}'`, GEMINI_MODELS)
  record(S, "oracle sanity: bad key fails, real key passes", plain !== "200" && realDirect === "200", `bad=${plain} real=${realDirect}`)

  const ph = gemini.placeholder
  const cases: [string, string, string][] = [
    ["header (x-goog-api-key)", `-H 'x-goog-api-key: ${ph}'`, GEMINI_MODELS],
    ["query string (?key=)", "", `${GEMINI_MODELS}?key=${ph}`],
    ["header, placeholder read from env at runtime", `-H "x-goog-api-key: $BA_VERIFY_GEMINI"`, GEMINI_MODELS],
  ]
  for (const [check, args, url] of cases) {
    const status = await httpStatus(sandbox, args, url)
    record(S, `swapped in ${check}`, status === "200", `HTTP ${status}`)
  }

  const basicUrl = `https://${ECHO_HOST}/basic-auth/u/${basicValue}`
  const basicPlain = await httpStatus(sandbox, `-u 'u:${basicValue}'`, basicUrl)
  const basicSwap = await httpStatus(sandbox, `-u 'u:${basic.placeholder}'`, basicUrl)
  record(S, "swapped inside Basic auth (git-style)", basicPlain === "200" ? basicSwap === "200" : "?",
    `real value→${basicPlain}, placeholder→${basicSwap}`)

  // Sending the REAL value: if the echo shows the placeholder instead, the
  // proxy is scrubbing the secret out of responses.
  const echoed = await sh(sandbox, `curl -sS --max-time 20 -H 'X-Test: ${basicValue}' 'https://${ECHO_HOST}/anything'`)
  record(S, "proxy scrubs the real value out of responses", echoed.includes(basic.placeholder) ? true : echoed.includes(basicValue) ? false : "?",
    echoed.includes(basic.placeholder) || echoed.includes(basicValue) ? "" : echoed)

  const other = await sh(sandbox, `curl -sS --max-time 20 -H 'X-Test: ${ph}' 'https://${OTHER_ECHO_HOST}/get'`)
  record(S, "placeholder sent to a host outside the allowlist arrives unswapped", other.includes(ph) && !other.includes(key), other.includes(ph) ? "" : other)

  for (const [check, command] of [["node fetch", NODE_FETCH], ["python urllib", PYTHON_FETCH]]) {
    const out = await sh(sandbox, command)
    record(S, `${check} trusts the proxy and gets the swap`, out.trim() === "200", out)
  }

  const issuer = async (host: string) =>
    (await sh(sandbox, `curl -sv --max-time 15 -o /dev/null https://${host}/ 2>&1 | grep -i 'issuer:' | head -1`)).replace(/^\*\s*/, "")
  record(S, `TLS issuer for ${GEMINI_HOST} (secret host)`, "info", await issuer(GEMINI_HOST))
  record(S, `TLS issuer for ${OTHER_ECHO_HOST} (other host)`, "info", await issuer(OTHER_ECHO_HOST))

  return ctx
}

// ─── lifecycle: detach, re-attach, rotate, delete ────────────────────────────

async function lifecycleSection(ctx: ProxyContext) {
  const S = "lifecycle"
  const { sandbox, gemini, basic } = ctx
  const swapped = (placeholder: string) => () => geminiSwapped(sandbox, placeholder)
  const both = { BA_VERIFY_GEMINI: gemini.name, BA_VERIFY_BASIC: basic.name }

  await sandbox.updateSecrets({})
  let t = await waitFor(async () => !(await geminiSwapped(sandbox, gemini.placeholder)), 60_000)
  record(S, "updateSecrets({}) stops the swap", t !== null, t !== null ? `after ~${t}ms` : "still swapped after 60s")
  record(S, "env var in new processes after detach", "info", `"${await sh(sandbox, `printf %s "$BA_VERIFY_GEMINI"`)}"`)

  await sandbox.updateSecrets(both)
  t = await waitFor(swapped(gemini.placeholder), 120_000)
  record(S, "re-attach after detach-all works WITHOUT a restart", t !== null, t !== null ? `swapping again after ~${t}ms` : "no swap after 120s")
  record(S, "env var in new processes after re-attach", "info", `"${await sh(sandbox, `printf %s "$BA_VERIFY_GEMINI"`)}"`)
  if (t === null) {
    const started = Date.now()
    await sandbox.stop()
    await sandbox.start()
    t = await waitFor(swapped(gemini.placeholder), 90_000)
    record(S, "...but works after a stop/start", t !== null, `restart ${Date.now() - started}ms, swap after ~${t}ms`)
  }

  // A secret created with a dummy value, then updated in place to the real key.
  const rotating = await makeSecret("rotating", randomValue("before-rotation"), [GEMINI_HOST])
  await sandbox.updateSecrets({ ...both, BA_VERIFY_ROTATING: rotating.name })
  record(S, "existing secrets keep working after the set changes", (await waitFor(swapped(gemini.placeholder), 60_000)) !== null)
  await daytona.secret.update(rotating.id, { value: ctx.key })
  t = await waitFor(swapped(rotating.placeholder), 120_000)
  record(S, "in-place value update (secret.update) reaches a mounted sandbox", t !== null, t !== null ? `after ~${t}ms` : "old value after 120s")

  await daytona.secret.delete(rotating.id)
  secretIds.delete(rotating.name)
  t = await waitFor(async () => !(await geminiSwapped(sandbox, rotating.placeholder)), 60_000)
  record(S, "deleting a mounted secret stops its swap", t !== null, t !== null ? `after ~${t}ms` : "still swapped after 60s")
  record(S, "other secrets keep working after one is deleted", await geminiSwapped(sandbox, gemini.placeholder))
  record(S, "sandbox state after deleting a mounted secret", "info", (await daytona.get(sandbox.id)).state ?? "?")
  try {
    await sandbox.updateSecrets({ ...both, BA_VERIFY_ROTATING: rotating.name })
    record(S, "updateSecrets referencing a deleted secret is rejected", false, "accepted")
  } catch (err) {
    record(S, "updateSecrets referencing a deleted secret is rejected", true, errorText(err))
  }
}

// ─── restart: a sandbox created without secrets ──────────────────────────────

async function restartSection(ctx: ProxyContext | undefined) {
  const S = "restart"
  if (!ctx) return
  const sandbox = await makeSandbox()
  const swapped = () => geminiSwapped(sandbox, ctx.gemini.placeholder)

  await sandbox.updateSecrets({ BA_VERIFY_GEMINI: ctx.gemini.name })
  let t = await waitFor(swapped, 60_000)
  record(S, "attach to a sandbox CREATED WITHOUT secrets works without restart", t !== null, t !== null ? `after ~${t}ms` : "no swap after 60s")

  const started = Date.now()
  await sandbox.stop()
  await sandbox.start()
  record(S, "stop/start duration", "info", `${Date.now() - started}ms`)
  t = await waitFor(swapped, 90_000)
  record(S, "works after stop/start", t !== null, t !== null ? `after ~${t}ms` : "no swap after 90s")
}

// ─── limits ──────────────────────────────────────────────────────────────────

async function limitsSection(sandbox: Sandbox | undefined) {
  const S = "limits"
  const target = sandbox ?? (await makeSandbox())
  let maxLabel = 0
  for (const n of [63, 64, 128, 255, 256, 1024, 4096]) {
    try {
      await target.setLabels({ ...target.labels, "ba-verify-len": "x".repeat(n) })
      maxLabel = n
    } catch (err) {
      record(S, `label value of ${n} chars`, false, errorText(err))
      break
    }
  }
  record(S, "longest label value accepted (tested 63..4096)", "info", String(maxLabel))

  let maxName = 0
  for (const n of [63, 64, 128, 255, 256]) {
    const name = `${PREFIX}_n`.padEnd(n, "x")
    try {
      const s = await daytona.secret.create({ name, value: "x", hosts: [ECHO_HOST] })
      secretIds.set(name, s.id)
      maxName = n
    } catch (err) {
      record(S, `secret name of ${n} chars`, false, errorText(err))
      break
    }
  }
  record(S, "longest secret name accepted (tested 63..256)", "info", String(maxName))

  try {
    const s = await makeSecret("nohosts", "x")
    record(S, "secret with no hosts (unrestricted) allowed", true, s.name)
  } catch (err) {
    record(S, "secret with no hosts (unrestricted) allowed", false, errorText(err))
  }
  try {
    await makeSecret("wildcard", "x", [`*.${ECHO_HOST}`])
    record(S, "wildcard host (*.example.com) accepted", true)
  } catch (err) {
    record(S, "wildcard host (*.example.com) accepted", false, errorText(err))
  }

  const { total } = await daytona.secret.list({ limit: 1 })
  record(S, "secrets currently in the org", "info", String(total))
}

// ─── cli: every agent with placeholder keys ──────────────────────────────────

interface Provider { label: string; credential: keyof Credentials; hosts: string[]; envKey?: string }

const PROVIDERS: Provider[] = [
  { label: "opencode", credential: "OPENCODE_API_KEY", hosts: ["opencode.ai", "*.opencode.ai"], envKey: "OPENCODE_API_KEY" },
  { label: "gemini", credential: "GEMINI_API_KEY", hosts: ["generativelanguage.googleapis.com"], envKey: "GEMINI_API_KEY" },
  { label: "anthropic", credential: "ANTHROPIC_API_KEY", hosts: ["api.anthropic.com"] },
  { label: "openai", credential: "OPENAI_API_KEY", hosts: ["api.openai.com"] },
  { label: "kimi", credential: "KIMI_API_KEY", hosts: ["api.moonshot.ai", "api.moonshot.cn", "api.kimi.com"] },
  { label: "kilo", credential: "KILO_API_KEY", hosts: ["kilo.ai", "*.kilo.ai", "kilocode.ai", "*.kilocode.ai"] },
  { label: "factory", credential: "FACTORY_API_KEY", hosts: ["factory.ai", "*.factory.ai"] },
  { label: "github", credential: "COPILOT_GITHUB_TOKEN", hosts: ["api.github.com", "*.githubcopilot.com"] },
  { label: "commandcode", credential: "COMMAND_CODE_API_KEY", hosts: ["commandcode.ai", "*.commandcode.ai"] },
]

const RUNS: { agent: Agent; model: string; real: boolean; note?: string; extraEnv?: (ph: Record<string, string>) => Record<string, string> }[] = [
  { agent: "opencode", model: "opencode-go/mimo-v2.5", real: true },
  { agent: "gemini", model: "gemini-3.5-flash-lite", real: true },
  { agent: "pi", model: "google/gemini-2.5-flash", real: true },
  { agent: "droid", model: "gemini-2.5-flash", real: true },
  { agent: "claude-code", model: "sonnet", real: false },
  { agent: "claude-code", model: "sonnet", real: false, note: "OAuth token", extraEnv: (ph) => ({ CLAUDE_CODE_OAUTH_TOKEN: ph.anthropic }) },
  { agent: "codex", model: "gpt-6.1-sol", real: false },
  { agent: "goose", model: "gpt-4o", real: false },
  { agent: "kimi", model: "kimi-k2.7-code", real: false },
  { agent: "kilo", model: "kilo/kilo-auto/efficient", real: false },
  { agent: "copilot", model: "auto", real: false },
  { agent: "command-code", model: "xiaomi/mimo-v2.6-flash", real: false },
]

const TLS_ERROR = /certificate|self[- ]signed|unable to (get|verify)|UNABLE_TO_|CERT_|tls|ssl|handshake/i
const AUTH_ERROR = /401|403|unauthori[sz]ed|forbidden|invalid.{0,30}(key|token|credential)|incorrect api key|authenticat|api key not valid|permission/i

async function runAgent(sandbox: Sandbox, agent: Agent, model: string, env: Record<string, string>, timeoutMs = 240_000) {
  const session = await createSession(agentToProvider[agent], { sandbox, model, env, cwd: "/home/daytona/verify" })
  await session.start("Reply with exactly the word OK and nothing else. Do not use any tools.")
  const events: Event[] = []
  const deadline = Date.now() + timeoutMs
  let running = true
  while (running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    const res = await session.getEvents()
    events.push(...res.events)
    running = res.running && !events.some((e) => e.type === "end" || e.type === "agent_crashed")
  }
  const text = events.filter((e) => e.type === "token").map((e) => (e as { text: string }).text).join("")
  const end = events.find((e) => e.type === "end") as { error?: string } | undefined
  const crash = events.find((e) => e.type === "agent_crashed") as { message?: string; output?: string } | undefined
  const error = end?.error ?? [crash?.message, crash?.output].filter(Boolean).join(" ")
  return { text, error, timedOut: running }
}

async function cliSection() {
  const S = "cli"
  const placeholders: Record<string, string> = {}
  const mounts: Record<string, string> = {}
  const credentials: Credentials = {}
  for (const p of PROVIDERS) {
    const real = p.envKey ? process.env[p.envKey]?.split(",")[0]?.trim() : undefined
    if (real) realValues.push(real)
    const value = real ?? randomValue(`dummy-${p.label}`)
    const secret = await makeSecret(`cli_${p.label}`, value, p.hosts)
    placeholders[p.label] = secret.placeholder
    mounts[`BA_VERIFY_${p.label.toUpperCase()}`] = secret.name
    credentials[p.credential] = secret.placeholder
    record(S, `secret for ${p.label}`, "info", `${real ? "REAL key" : "dummy value"}, hosts ${p.hosts.join(" ")}`)
  }
  const sandbox = await makeSandbox(mounts)
  await sh(sandbox, "mkdir -p /home/daytona/verify && cd /home/daytona/verify && git init -q && echo ok")

  for (const host of [...new Set(PROVIDERS.flatMap((p) => p.hosts).filter((h) => !h.startsWith("*")))]) {
    const issuer = await sh(sandbox, `curl -sv --max-time 15 -o /dev/null https://${host}/ 2>&1 | grep -iE 'issuer:|Could not resolve' | head -1`)
    record(S, `TLS issuer for ${host}`, "info", issuer.replace(/^\*\s*/, "") || "(no TLS info)")
  }

  for (const run of RUNS) {
    const label = `${run.agent} ${run.model}${run.note ? ` (${run.note})` : ""}`
    const env = { ...getEnvForModel(run.model, run.agent, credentials), ...run.extraEnv?.(placeholders) }
    const started = Date.now()
    try {
      const { text, error, timedOut } = await runAgent(sandbox, run.agent, run.model, env)
      const secs = Math.round((Date.now() - started) / 1000)
      const all = `${error} ${text}`
      let outcome: string
      if (!error && /\bok\b/i.test(text)) outcome = "SUCCESS"
      else if (timedOut) outcome = "TIMEOUT"
      else if (TLS_ERROR.test(all)) outcome = "TLS FAILURE"
      else if (AUTH_ERROR.test(all)) outcome = run.real ? "AUTH REJECTED (real key!)" : "REACHED PROVIDER (dummy rejected)"
      else outcome = "OTHER"
      const which = all.includes("ba-verif") ? " [provider saw the swapped dummy]" : all.includes("dtn_secr") ? " [provider saw the PLACEHOLDER]" : ""
      record(S, label, outcome + which, `${secs}s, env=${Object.keys(env).join(",")} :: ${error || text}`)
    } catch (err) {
      record(S, label, "SCRIPT ERROR", errorText(err))
    }
  }

  const discovery = await sh(sandbox, `for b in kilo cmd commandcode copilot droid kimi goose; do p=$(command -v $b) || continue; d=$(dirname $(readlink -f $p)); echo "== $b $p"; grep -rahoE 'https://[a-z0-9.-]*(api|kilo|command|factory|copilot|moonshot|kimi)[a-z0-9.-]*\\.(ai|com|dev|cn)' "$d/.." 2>/dev/null | sort | uniq -c | sort -rn | head -6; done`, 120)
  record(S, "hosts referenced by installed CLIs", "info", discovery)
}

// ─── control: placeholder vs a plain dummy, for ambiguous CLI errors ─────────

/**
 * A CLI that fails the same way with a placeholder as with a plain dummy key
 * treats the placeholder like any key; one that fails differently (or never
 * reaches the provider) is rejecting it locally, e.g. on its format.
 */
async function controlSection() {
  const S = "control"
  const anthropic = await makeSecret("ctl_anthropic", randomValue("dummy-anthropic"), ["api.anthropic.com"])
  const github = await makeSecret("ctl_github", randomValue("dummy-github"), ["api.github.com", "*.githubcopilot.com"])
  const commandcode = await makeSecret("ctl_commandcode", randomValue("dummy-commandcode"), ["commandcode.ai", "*.commandcode.ai"])
  const sandbox = await makeSandbox({ BA_VERIFY_A: anthropic.name, BA_VERIFY_G: github.name, BA_VERIFY_C: commandcode.name })
  await sh(sandbox, "mkdir -p /home/daytona/verify && cd /home/daytona/verify && git init -q && echo ok")

  const cases: [string, Agent, string, Record<string, string>][] = [
    ["claude OAuth token only, placeholder", "claude-code", "sonnet", { CLAUDE_CODE_OAUTH_TOKEN: anthropic.placeholder }],
    ["claude OAuth token only, plain sk-ant-oat01 dummy", "claude-code", "sonnet", { CLAUDE_CODE_OAUTH_TOKEN: `sk-ant-oat01-${randomBytes(20).toString("hex")}` }],
    ["claude API key, plain dummy", "claude-code", "sonnet", { ANTHROPIC_API_KEY: randomValue("plain") }],
    ["copilot, placeholder", "copilot", "auto", { COPILOT_GITHUB_TOKEN: github.placeholder }],
    ["copilot, plain github_pat_ dummy", "copilot", "auto", { COPILOT_GITHUB_TOKEN: `github_pat_11${randomBytes(20).toString("hex")}` }],
    ["copilot, plain random dummy", "copilot", "auto", { COPILOT_GITHUB_TOKEN: randomValue("plain") }],
    ["command-code, placeholder", "command-code", "xiaomi/mimo-v2.6-flash", { COMMAND_CODE_API_KEY: commandcode.placeholder }],
    ["command-code, plain dummy", "command-code", "xiaomi/mimo-v2.6-flash", { COMMAND_CODE_API_KEY: randomValue("plain") }],
  ]
  for (const [label, agent, model, env] of cases) {
    try {
      const { text, error, timedOut } = await runAgent(sandbox, agent, model, env, 120_000)
      record(S, label, timedOut ? "TIMEOUT" : error ? "ERROR" : "NO ERROR", error || text)
    } catch (err) {
      record(S, label, "SCRIPT ERROR", errorText(err))
    }
  }
}

// ─── real: every OpenCode pool key, and a Claude OAuth token if given ────────

/**
 * End-to-end runs with real credentials: each configured OpenCode key (which
 * also shows which pool keys still work) and, when VERIFY_CLAUDE_OAUTH_TOKEN
 * is set, a Claude subscription access token. Only an access token is ever
 * used — never a refresh token, which a run could rotate.
 */
async function realSection() {
  const S = "real"
  const runs: { label: string; agent: Agent; model: string; envName: string; secretEnv: string; secret: Awaited<ReturnType<typeof makeSecret>> }[] = []

  // VERIFY_OPENCODE_EXTRA_KEYS: more keys to check beyond the configured pool.
  const opencodeKeys = [process.env.OPENCODE_API_KEY, process.env.VERIFY_OPENCODE_EXTRA_KEYS]
    .flatMap((list) => (list ?? "").split(","))
    .map((k) => k.trim())
    .filter(Boolean)
  for (const [i, key] of opencodeKeys.entries()) {
    realValues.push(key)
    const secret = await makeSecret(`real_opencode_${i}`, key, ["opencode.ai", "*.opencode.ai"])
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 12)
    runs.push({ label: `opencode key #${i + 1} (opencode_${hash})`, agent: "opencode", model: "opencode-go/mimo-v2.5", envName: "OPENCODE_API_KEY", secretEnv: `BA_VERIFY_OC_${i}`, secret })
  }

  const claudeToken = process.env.VERIFY_CLAUDE_OAUTH_TOKEN?.trim()
  if (claudeToken) {
    realValues.push(claudeToken)
    const secret = await makeSecret("real_claude_oauth", claudeToken, ["api.anthropic.com"])
    runs.push({ label: "claude-code sonnet, OAuth access token only", agent: "claude-code", model: "sonnet", envName: "CLAUDE_CODE_OAUTH_TOKEN", secretEnv: "BA_VERIFY_CLAUDE", secret })
  }

  const sandbox = await makeSandbox(Object.fromEntries(runs.map((r) => [r.secretEnv, r.secret.name])))
  await sh(sandbox, "mkdir -p /home/daytona/verify && cd /home/daytona/verify && git init -q && echo ok")
  for (const run of runs) {
    try {
      const { text, error, timedOut } = await runAgent(sandbox, run.agent, run.model, { [run.envName]: run.secret.placeholder }, 180_000)
      const outcome = !error && /\bok\b/i.test(text) ? "SUCCESS" : timedOut ? "TIMEOUT" : "ERROR"
      record(S, run.label, outcome, error || text)
    } catch (err) {
      record(S, run.label, "SCRIPT ERROR", errorText(err))
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

let deletedSandboxes = 0

/** Deletes this run's sandboxes; called after each section to stay under the org's memory limit. */
async function dropSandboxes() {
  for (const sandbox of sandboxes.splice(0)) {
    await sandbox.delete().catch(() => {})
    deletedSandboxes++
  }
}

async function cleanup() {
  await dropSandboxes()
  for (const id of secretIds.values()) await daytona.secret.delete(id).catch(() => {})
  try {
    const { items } = await daytona.secret.list({ name: PREFIX, limit: 200 })
    for (const s of items) if (s.name.startsWith(PREFIX)) await daytona.secret.delete(s.id).catch(() => {})
  } catch { /* best effort */ }
  console.log(`cleaned up ${deletedSandboxes} sandboxes and secrets with prefix ${PREFIX}`)
}

async function main() {
  const args = process.argv.slice(2)
  const sections: string[] = []
  let out: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i]
    else sections.push(args[i])
  }
  const want = (s: string) => sections.length === 0 || sections.includes(s)

  process.on("SIGINT", () => { void cleanup().then(() => process.exit(130)) })
  console.log(`run ${RUN}`)
  try {
    await daytona.secret.list({ limit: 1 })
  } catch (err) {
    console.error(
      `This Daytona API key cannot use secrets (${errorText(err)}). Create a key with the secrets ` +
        "permissions and pass it as VERIFY_DAYTONA_API_KEY (or update DAYTONA_API_KEY)."
    )
    process.exit(1)
  }
  const section = async (name: string, run: () => Promise<void>) => {
    if (!want(name)) return
    try {
      await run()
    } catch (err) {
      record(name, "section failed", "ERROR", errorText(err))
    } finally {
      await dropSandboxes()
    }
  }
  try {
    let proxy: ProxyContext | undefined
    await section("proxy", async () => {
      proxy = await proxySection()
      if (proxy) await lifecycleSection(proxy)
    })
    await section("restart", () => restartSection(proxy))
    await section("limits", () => limitsSection(undefined))
    await section("cli", cliSection)
    await section("control", controlSection)
    await section("real", realSection)
  } finally {
    await cleanup()
    if (out) writeFileSync(out, JSON.stringify(results, null, 2))
  }
}

void main()
