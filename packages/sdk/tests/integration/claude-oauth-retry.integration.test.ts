import { spawn } from "node:child_process"
import { createServer, type Server } from "node:http"
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CLAUDE_OAUTH_RUNNER_SOURCE } from "../../src/agents/claude/oauth-runner"

const executable = process.env.CLAUDE_CODE_TEST_EXECUTABLE
let directory: string | undefined
let server: Server | undefined

afterEach(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
    server = undefined
  }
  if (directory) {
    const target = path.resolve(directory)
    if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("claude-oauth-integration-")) {
      throw new Error("Refusing to remove a directory outside the test temporary root")
    }
    await rm(target, { recursive: true, force: true })
    directory = undefined
  }
})

function events(model: string, content: Record<string, unknown>, stopReason: string): string {
  const isTool = content.type === "tool_use"
  const sequence = [
    ["message_start", { type: "message_start", message: { id: "msg_synthetic", type: "message", role: "assistant",
      model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: isTool ? { ...content, input: {} } : { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: isTool
      ? { type: "input_json_delta", partial_json: JSON.stringify(content.input) }
      : { type: "text_delta", text: content.text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ]
  return sequence.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("")
}

// Uses a real installed CLI and fake local services, without a Claude login,
// production token, Daytona sandbox, or model charge. Opt in with its path.
describe.skipIf(!executable)("native Claude OAuth retry", () => {
  it.each([
    { name: "retries with a fresh token without repeating completed tools", rotate: true },
    { name: "stops when the rejected token is unchanged without repeating completed tools", rotate: false },
  ])("$name", async ({ rotate }) => {
    directory = await mkdtemp(path.join(tmpdir(), "claude-oauth-integration-"))
    const runner = path.join(directory, "runner.mjs")
    const marker = path.join(directory, "tool-count.txt")
    await writeFile(runner, CLAUDE_OAUTH_RUNNER_SOURCE)
    let tokenReads = 0
    let output = "", errors = "", outputBeforeRecovery = ""
    const calls: { body: string; authorization?: string }[] = []
    const model = "claude-sonnet-4-6"
    const command = 'node -e "require(\'node:fs\').appendFileSync(' +
      JSON.stringify(marker.replaceAll("\\", "/")).replaceAll('"', "'") + ',\'done\\n\')"'
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => {
        if (request.url === "/token") {
          tokenReads++
          if (tokenReads === 2) outputBeforeRecovery = output
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end(JSON.stringify({ accessToken: tokenReads === 1 || !rotate
            ? "sk-ant-oat01-old-synthetic-test" : "sk-ant-oat01-new-synthetic-test" }))
          return
        }
        if (!request.url?.startsWith("/v1/messages?")) {
          response.writeHead(200, { "Content-Type": "application/json" })
          response.end("{}")
          return
        }
        calls.push({ body: Buffer.concat(chunks).toString(), authorization: request.headers.authorization })
        if (calls.length === 2) {
          response.writeHead(401, { "Content-Type": "application/json", "x-should-retry": "false" })
          response.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "OAuth token has expired" } }))
        } else {
          response.writeHead(200, { "Content-Type": "text/event-stream" })
          response.end(calls.length === 1
            ? events(model, { type: "tool_use", id: "completed-tool-test", name: "Bash", input: { command } }, "tool_use")
            : events(model, { type: "text", text: "Recovered successfully" }, "end_turn"))
        }
      })
    })
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Expected HTTP test server")
    const origin = `http://127.0.0.1:${address.port}`
    const env = { ...process.env }
    for (const key of Object.keys(env)) if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDECODE$)/.test(key)) delete env[key]
    Object.assign(env, {
      CLAUDE_CONFIG_DIR: path.join(directory, "config"), ANTHROPIC_BASE_URL: origin,
      CLAUDE_CODE_TOKEN_URL: `${origin}/token`, CLAUDE_CODE_TOKEN_AUTH: "capability-synthetic-test",
      CLAUDE_CODE_EXECUTABLE: executable!, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
    })
    const child = spawn(process.execPath, [runner, "-p", "--output-format", "stream-json", "--verbose",
      "--dangerously-skip-permissions", "--model", model, "--", "Do the work once"], { env, cwd: directory })
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
    child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString() })
    const timeout = setTimeout(() => child.kill(), 45_000)
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject)
      child.once("close", resolve)
    }).finally(() => clearTimeout(timeout))
    expect(code, errors).toBe(rotate ? 0 : 1)
    if (rotate) {
      expect(output).toContain("Recovered successfully")
      expect(output).not.toContain("Failed to authenticate")
      expect(calls).toHaveLength(3)
      expect(calls[2].authorization).toBe("Bearer sk-ant-oat01-new-synthetic-test")
      expect(JSON.parse(calls[2].body)).toEqual(JSON.parse(calls[1].body))
    } else {
      expect(calls).toHaveLength(2)
      expect(output).toContain('"api_error_status":401')
    }
    // The host receives completed work before recovery and the final result,
    // so the bridge preserves incremental output even if recovery fails.
    expect(outputBeforeRecovery).toContain("completed-tool-test")
    expect(outputBeforeRecovery).not.toContain('"type":"result"')
    expect(output).not.toContain("sk-ant-oat01-")
    expect(output).not.toContain("control_response")
    expect(calls[1].body).toContain("completed-tool-test")
    expect(await readFile(marker, "utf8")).toBe("done\n")
    expect(tokenReads).toBe(2)
  }, 60_000)
})
