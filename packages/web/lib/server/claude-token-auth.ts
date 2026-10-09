import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

// Admins can allow 24-hour runs. Active-run authorization revokes the grant
// when the run ends, even if the signed capability has not expired yet.
const CAPABILITY_LIFETIME_MS = 26 * 60 * 60 * 1000
const SIGNATURE_CONTEXT = "claude-token-read:v1:"

export interface ClaudeTokenScope {
  userId: string
  chatId: string
  backgroundSessionId: string
}

function signature(payload: string): Buffer {
  const key = process.env.NEXTAUTH_SECRET
  if (!key) throw new Error("NEXTAUTH_SECRET is required for shared Claude authentication")
  return createHmac("sha256", key).update(SIGNATURE_CONTEXT + payload).digest()
}

export function createClaudeTokenCapability(scope: ClaudeTokenScope): string {
  const payload = Buffer.from(JSON.stringify({ ...scope, expiresAt: Date.now() + CAPABILITY_LIFETIME_MS })).toString("base64url")
  return `${payload}.${signature(payload).toString("base64url")}`
}

function validScopeField(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512
}

export function verifyClaudeTokenCapability(token: string): ClaudeTokenScope | null {
  if (token.length > 4096) return null
  const parts = token.split(".")
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null
  const [payload, encodedSignature] = parts
  const supplied = Buffer.from(encodedSignature, "base64url")
  const expected = signature(payload)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  } catch {
    // Caller-controlled invalid capabilities are rejected without logging.
    return null
  }
  if (!value || typeof value !== "object") return null
  const fields = value as Partial<ClaudeTokenScope> & { expiresAt?: unknown }
  if (
    !validScopeField(fields.userId) || !validScopeField(fields.chatId) || !validScopeField(fields.backgroundSessionId) ||
    typeof fields.expiresAt !== "number" || !Number.isSafeInteger(fields.expiresAt) || fields.expiresAt <= Date.now()
  ) return null
  return { userId: fields.userId, chatId: fields.chatId, backgroundSessionId: fields.backgroundSessionId }
}

export function buildSharedClaudeEnv(env: Record<string, string>, scope: ClaudeTokenScope): Record<string, string> {
  const base = process.env.CLAUDE_CREDENTIALS_BASE_URL || process.env.NEXTAUTH_URL
  if (!base) throw new Error("CLAUDE_CREDENTIALS_BASE_URL or NEXTAUTH_URL is required for shared Claude")
  let url: URL
  try {
    url = new URL(base)
  } catch {
    // Parsing errors can include secret URL input.
    throw new Error("The Claude credentials URL must be a valid app URL")
  }
  if (
    url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:"))
  ) throw new Error("The Claude credentials URL must be an HTTPS app URL without credentials or query parameters")
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/claude-token`
  const next = { ...env }
  for (const key of [
    "CLAUDE_CODE_CREDENTIALS", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_OAUTH_SCOPES", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "CLAUDE_CODE_EXECUTABLE", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_CUSTOM_HEADERS",
    "ANTHROPIC_BASE_URL", "CLAUDE_CODE_CUSTOM_OAUTH_URL", "CLAUDE_CODE_USE_GATEWAY",
    "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "CLAUDE_CODE_USE_MANTLE",
  ]) delete next[key]
  next.CLAUDE_CODE_TOKEN_URL = url.toString()
  next.CLAUDE_CODE_TOKEN_AUTH = createClaudeTokenCapability(scope)
  return next
}
