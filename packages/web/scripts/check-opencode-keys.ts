/**
 * Checks whether each OpenCode key in an env file still works.
 *
 * Reads every OPENCODE_API_KEY line (commented-out ones too, each possibly
 * comma-separated) and sends each key one tiny chat request (max_tokens 1)
 * to OpenCode Go, which the shared pool runs on. Keys are never printed: each
 * is named by its Daytona secret name, opencode_<sha256[0:12]>, as in
 * lib/server/shared-key-pools.
 *
 * Run:  npx tsx scripts/check-opencode-keys.ts [--file .env.local] [--model mimo-v2.5]
 */
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

const URL = "https://opencode.ai/zen/go/v1/chat/completions"

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const file = arg("file", ".env.local")
const model = arg("model", "mimo-v2.5")

interface Key {
  value: string
  where: string
}

function readKeys(path: string): Key[] {
  const keys: Key[] = []
  const seen = new Set<string>()
  readFileSync(path, "utf8").split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^\s*(#\s*)?OPENCODE_API_KEY\s*=\s*(.*)$/)
    if (!m) return
    for (const raw of m[2].replace(/^["']|["']$/g, "").split(",")) {
      const value = raw.trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      keys.push({ value, where: `line ${i + 1}${m[1] ? " (commented out)" : ""}` })
    }
  })
  return keys
}

const secretName = (key: string) => `opencode_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`

async function check(key: string): Promise<{ status: string; detail: string }> {
  let res: Response
  try {
    res = await fetch(URL, {
      method: "POST",
      // Go refuses requests without the session header the OpenCode CLI sends.
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "x-opencode-session": randomUUID() },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    return { status: "UNKNOWN", detail: `request failed: ${err instanceof Error ? err.name : "error"}` }
  }
  const text = await res.text()
  let message = text
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string; message?: string }
    message = (typeof body.error === "string" ? body.error : body.error?.message) ?? body.message ?? ""
  } catch {
    // Not JSON: keep the raw text.
  }
  // Errors can echo the key back.
  message = message.split(key).join("<key>").replace(/\s+/g, " ").slice(0, 200)

  if (res.ok) return { status: "ACTIVE", detail: `HTTP ${res.status}` }
  if (/usage limit|quota|balance|insufficient|credit/i.test(message)) {
    return { status: "LIMIT REACHED", detail: `HTTP ${res.status}: ${message}` }
  }
  if (/expired/i.test(message)) return { status: "EXPIRED", detail: `HTTP ${res.status}: ${message}` }
  if (res.status === 401 || res.status === 403 || /invalid|unauthori[sz]ed/i.test(message)) {
    return { status: "INVALID", detail: `HTTP ${res.status}: ${message}` }
  }
  return { status: "UNKNOWN", detail: `HTTP ${res.status}: ${message}` }
}

async function main() {
  const keys = readKeys(file)
  if (keys.length === 0) {
    console.log(`No OPENCODE_API_KEY values in ${file}`)
    return
  }
  console.log(`Checking ${keys.length} OpenCode key(s) from ${file} with model ${model}\n`)
  for (const key of keys) {
    const { status, detail } = await check(key.value)
    console.log(`${status.padEnd(16)} ${secretName(key.value)}  ${key.where}\n${" ".repeat(17)}${detail}`)
  }
}

main().catch((err) => {
  console.error("check failed:", err instanceof Error ? err.message : err)
  process.exit(1)
})
