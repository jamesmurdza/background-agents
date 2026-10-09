/**
 * This bridge speaks Claude's stream-json host protocol. Model requests and
 * responses stay inside Claude; only credential reads go to the host app.
 * Keep the source self-contained because setup installs it inside the sandbox.
 */
export const CLAUDE_OAUTH_RUNNER_PATH = "/tmp/codeagent-claude-oauth-runner.mjs"
export const CLAUDE_OAUTH_RUNNER_SOURCE = String.raw`
import { spawn, execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const abort = new AbortController();
let child;
let pendingToken;

async function readToken() {
  const response = await fetch(process.env.CLAUDE_CODE_TOKEN_URL, {
    headers: { Authorization: "Bearer " + process.env.CLAUDE_CODE_TOKEN_AUTH },
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Shared Claude credentials are unavailable");
  }
  const value = await response.json();
  if (!value || typeof value.accessToken !== "string" || !value.accessToken.trim()) {
    throw new Error("Shared Claude credentials are unavailable");
  }
  return value.accessToken;
}

function freshToken() {
  // Concurrent native requests may need recovery together. Share the DB read,
  // while answering each control request with its own request_id.
  if (!pendingToken) pendingToken = readToken().finally(() => { pendingToken = undefined; });
  return pendingToken;
}

function answer(requestId, response) {
  if (!child.stdin.destroyed && !child.stdin.writableEnded) {
    child.stdin.write(JSON.stringify({ type: "control_response", response: {
      subtype: "success", request_id: requestId, response,
    } }) + "\n");
  }
}

async function recover(message) {
  try {
    const token = await freshToken();
    // Claude compares this with the token used by the failed request. Leave
    // that comparison to Claude: concurrent calls can fail with different
    // tokens. Never rotate the shared refresh token from this sandbox.
    answer(message.request_id, { accessToken: token });
  } catch {
    // Expected unavailable/expired credentials: let Claude report its terminal
    // auth failure without logging token-bearing Fetch errors or responses.
    process.stderr.write("[claude-oauth] Credential recovery unavailable\n");
    answer(message.request_id, { accessToken: null });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const separator = args.indexOf("--");
  const prompt = separator === -1 ? "" : args[separator + 1] ?? "";
  const cliArgs = separator === -1 ? args : args.slice(0, separator);
  cliArgs.push("--input-format", "stream-json");
  const env = { ...process.env };
  for (const key of ["CLAUDE_CODE_TOKEN_URL", "CLAUDE_CODE_TOKEN_AUTH", "CLAUDE_CODE_CREDENTIALS",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR",
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_CUSTOM_HEADERS"]) delete env[key];
  // The native OAuth callback is restricted to host entrypoints. This runner
  // acts as a local-agent host, with stdin kept open for control responses.
  env.CLAUDE_CODE_ENTRYPOINT = "local-agent";
  env.CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH = "1";
  const executable = process.env.CLAUDE_CODE_EXECUTABLE ?? "claude";
  const version = await promisify(execFile)(executable, ["--version"], { env, timeout: 15000 });
  const parts = /^(\d+)\.(\d+)\.(\d+)/.exec(version.stdout.trim());
  if (!parts || Number(parts[1]) !== 2 || Number(parts[2]) !== 1 || Number(parts[3]) < 283) {
    process.stderr.write("[claude-oauth] Shared OAuth recovery requires Claude Code 2.1.283 or later in the 2.1 series\n");
    process.exitCode = 1;
    return;
  }
  env.CLAUDE_CODE_OAUTH_TOKEN = await freshToken();
  if (abort.signal.aborted) return;
  child = spawn(executable, cliArgs, {
    env, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.pipe(process.stderr);
  child.on("error", () => {
    process.stderr.write("[claude-oauth] Could not start Claude\n");
    process.exitCode = 1;
    abort.abort();
  });
  child.stdin.on("error", () => {
    // A terminal Claude exit can race a pending callback. Fail rather than
    // starting another process or sending the prompt a second time.
    process.stderr.write("[claude-oauth] Claude control input closed\n");
    process.exitCode = 1;
  });
  child.on("close", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
    abort.abort();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch {
      // Keep non-JSON CLI diagnostics observable. They are ignored by the
      // agent event parser, as they are on the direct CLI path.
      process.stdout.write(line + "\n");
      return;
    }
    if (message?.type === "control_request") {
      if (message.request?.subtype === "oauth_token_refresh") void recover(message);
      else {
        process.stderr.write("[claude-oauth] Unsupported Claude control request\n");
        if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(JSON.stringify({
          type: "control_response", response: { subtype: "error", request_id: message.request_id,
            error: "Unsupported host control request" },
        }) + "\n");
      }
      return;
    }
    // Credential control traffic must never become part of the transcript.
    if (["control_response", "control_cancel_request"].includes(message?.type)) return;
    process.stdout.write(line + "\n");
    if (message?.type === "result") child.stdin.end();
  });
  child.stdin.write(JSON.stringify({ type: "control_request", request_id: "host-initialize",
    request: { subtype: "initialize" },
  }) + "\n");
  child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt },
    parent_tool_use_id: null, session_id: "",
  }) + "\n");
}

for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  abort.abort();
  if (child) child.kill(signal);
  else process.exitCode = signal === "SIGINT" ? 130 : 143;
});

main().catch(() => {
  process.stderr.write("[claude-oauth] Cannot obtain shared Claude credentials\n");
  process.exitCode = 1;
});
`
