/**
 * Terminal Sandbox Setup
 *
 * Functions to set up, manage, and tear down the PTY terminal server
 * inside a Daytona sandbox.
 */

import type { Sandbox } from "@daytonaio/sdk"
import { getPtyServerCode, getPtyServerPackageJson, PTY_SERVER_PORT } from "../server"

/**
 * Result from terminal setup operations
 */
export interface TerminalSetupResult {
  /** Current status of the terminal server */
  status: "running" | "starting" | "stopped" | "error"
  /** WebSocket URL for connecting to the terminal (wss://) */
  websocketUrl?: string
  /** HTTPS URL for health checks */
  httpsUrl?: string
  /** Port the server is running on */
  port: number
  /** Error message if status is "error" */
  error?: string
  /** Additional error details */
  details?: string
}

/**
 * Options for terminal setup
 */
export interface TerminalSetupOptions {
  /** How long the signed URL should be valid for (in seconds). Default: 3600 */
  expiresIn?: number
  /** Custom port for the PTY server. Default: 44777 */
  port?: number
}

const PROCESS_NAME = "websocket-pty-server"

/**
 * Where the PTY server's files live inside the sandbox. The
 * `background-agents` snapshot pre-creates this directory and pre-installs
 * `ws` + `node-pty` here at image build time, so `setupTerminal` skips the
 * install step on first terminal open. On other images the install runs
 * once into this directory and is cached for subsequent calls.
 */
const INSTALL_DIR = "/opt/pty-server"
const LOG_FILE = `${INSTALL_DIR}/server.log`
const INSTALL_LOCK = `${INSTALL_DIR}/.install.lock`

/**
 * Check if the PTY server process is running in the sandbox
 */
async function isServerRunning(sandbox: Sandbox): Promise<boolean> {
  const result = await sandbox.process.executeCommand(
    `pgrep -f "node.*${PROCESS_NAME}" > /dev/null && echo "running" || echo "stopped"`,
    undefined,
    undefined,
    10
  )
  return result.result?.trim() === "running"
}

/**
 * Get the terminal server status
 */
export async function getTerminalStatus(
  sandbox: Sandbox,
  options: TerminalSetupOptions = {}
): Promise<TerminalSetupResult> {
  const port = options.port ?? PTY_SERVER_PORT
  const expiresIn = options.expiresIn ?? 3600

  const running = await isServerRunning(sandbox)

  if (running) {
    const signedUrl = await sandbox.getSignedPreviewUrl(port, expiresIn)
    const wsUrl = signedUrl.url.replace("https://", "wss://")

    return {
      status: "running",
      websocketUrl: wsUrl,
      httpsUrl: signedUrl.url,
      port,
    }
  }

  return { status: "stopped", port }
}

/**
 * Stop the terminal server
 */
export async function stopTerminal(sandbox: Sandbox): Promise<TerminalSetupResult> {
  await sandbox.process.executeCommand(
    `pkill -f "node.*${PROCESS_NAME}" || true`,
    undefined,
    undefined,
    10
  )
  return { status: "stopped", port: PTY_SERVER_PORT }
}

/**
 * Set up and start the PTY terminal server in a Daytona sandbox.
 *
 * This function:
 * 1. Checks if the server is already running (returns existing URL if so)
 * 2. Uploads the PTY server code to the sandbox
 * 3. Installs dependencies (ws, node-pty)
 * 4. Starts the server
 * 5. Returns a signed WebSocket URL for connecting
 *
 * @example
 * ```typescript
 * import { Daytona } from "@daytonaio/sdk"
 * import { setupTerminal, WebSocketTerminal } from "@background-agents/daytona-terminal"
 *
 * const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
 * const sandbox = await daytona.create()
 *
 * const { websocketUrl, status } = await setupTerminal(sandbox)
 *
 * if (status === "running" && websocketUrl) {
 *   // Use websocketUrl with WebSocketTerminal component
 * }
 * ```
 */
export async function setupTerminal(
  sandbox: Sandbox,
  options: TerminalSetupOptions = {}
): Promise<TerminalSetupResult> {
  const port = options.port ?? PTY_SERVER_PORT
  const expiresIn = options.expiresIn ?? 3600

  // Check if already running
  if (await isServerRunning(sandbox)) {
    const signedUrl = await sandbox.getSignedPreviewUrl(port, expiresIn)
    const wsUrl = signedUrl.url.replace("https://", "wss://")

    const logTail = await sandbox.process.executeCommand(
      `tail -30 ${LOG_FILE} 2>/dev/null || echo "(no log)"`,
      undefined,
      undefined,
      10
    )
    console.log(
      `[terminal] reusing existing server\n  wsUrl=${wsUrl}\n  ${LOG_FILE} tail:\n${logTail.result}`
    )

    return {
      status: "running",
      websocketUrl: wsUrl,
      httpsUrl: signedUrl.url,
      port,
    }
  }

  // Ensure the install directory exists and is writable. On the
  // `background-agents` snapshot this is a no-op (the image pre-creates
  // it owned by daytona); on other images it's the first-time setup.
  await sandbox.process.executeCommand(
    `mkdir -p ${INSTALL_DIR} 2>/dev/null || sudo mkdir -p ${INSTALL_DIR} && sudo chown -R $(id -u):$(id -g) ${INSTALL_DIR}`,
    undefined,
    undefined,
    10
  )

  // Upload server files to sandbox
  const serverCode = getPtyServerCode()
  const packageJson = getPtyServerPackageJson()

  await sandbox.fs.uploadFile(
    Buffer.from(serverCode),
    `${INSTALL_DIR}/websocket-pty-server.js`
  )
  await sandbox.fs.uploadFile(
    Buffer.from(packageJson),
    `${INSTALL_DIR}/package.json`
  )

  // Install dependencies
  // Two things to coordinate:
  //   1. Concurrent setup calls (e.g. two terminal tabs opening at once)
  //      must not run npm install in parallel, or one will rm -rf the other's
  //      half-extracted tarball and corrupt the npm cache.
  //   2. node-gyp 12.1.0 crashes in a post-build cleanup step on older
  //      node-pty versions even after successfully producing pty.node, so we
  //      verify the artifact on disk rather than trusting npm's exit code.
  // flock serialises installs across processes inside the sandbox, and the
  // inner check makes the locked section a no-op if pty.node is already there
  // (which is the fast path when the snapshot pre-installed the deps).
  const installResult = await sandbox.process.executeCommand(
    `flock -w 120 ${INSTALL_LOCK} bash -c '
      if [ -f ${INSTALL_DIR}/node_modules/node-pty/build/Release/pty.node ] && [ -d ${INSTALL_DIR}/node_modules/ws ]; then
        echo "[install] already present, skipping"
        exit 0
      fi
      rm -rf ${INSTALL_DIR}/node_modules/node-pty
      cd ${INSTALL_DIR} && npm install --prefix ${INSTALL_DIR} ws node-pty 2>&1
    '`,
    undefined,
    undefined,
    120
  )

  // Verify installation succeeded
  const ptyArtifactCheck = await sandbox.process.executeCommand(
    `test -f ${INSTALL_DIR}/node_modules/node-pty/build/Release/pty.node && test -d ${INSTALL_DIR}/node_modules/ws && echo ok || echo missing`,
    undefined,
    undefined,
    10
  )

  if (ptyArtifactCheck.result?.trim() !== "ok") {
    const dirListing = await sandbox.process.executeCommand(
      `ls -la ${INSTALL_DIR}/node_modules/node-pty/build/Release/ 2>&1; echo ---; ls -la ${INSTALL_DIR}/node_modules/node-pty/ 2>&1; echo ---; ls ${INSTALL_DIR}/node_modules/ 2>&1`,
      undefined,
      undefined,
      10
    )
    console.error(
      "[terminal] Failed to install dependencies:",
      installResult.result,
      "\n[terminal] node-pty tree after install:\n",
      dirListing.result
    )
    return {
      status: "error",
      port,
      error: "Failed to install terminal dependencies",
      details: installResult.result,
    }
  }

  // Start the PTY server via a session command with runAsync: true so the
  // call returns immediately. The session is left in place — deleting it
  // would reap the server.
  const sessionId = `pty-server-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  try {
    await sandbox.process.createSession(sessionId)
    await sandbox.process.executeSessionCommand(
      sessionId,
      {
        command: `cd ${INSTALL_DIR} && node websocket-pty-server.js > ${LOG_FILE} 2>&1 < /dev/null`,
        runAsync: true,
      },
      30
    )
  } catch (err) {
    console.error("[terminal] Failed to start server:", err)
    return {
      status: "error",
      port,
      error: "Failed to start terminal server",
      details: err instanceof Error ? err.message : String(err),
    }
  }

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Verify server is running
  if (!(await isServerRunning(sandbox))) {
    const logResult = await sandbox.process.executeCommand(
      `cat ${LOG_FILE} 2>/dev/null | tail -20`,
      undefined,
      undefined,
      10
    )
    console.error("[terminal] Server failed to start, log:", logResult.result)

    return {
      status: "error",
      port,
      error: "Terminal server failed to start",
      details: logResult.result,
    }
  }

  // Get signed preview URL
  const signedUrl = await sandbox.getSignedPreviewUrl(port, expiresIn)
  const wsUrl = signedUrl.url.replace("https://", "wss://")

  const logTail = await sandbox.process.executeCommand(
    `tail -30 ${LOG_FILE} 2>/dev/null || echo "(no log)"`,
    undefined,
    undefined,
    10
  )
  console.log(
    `[terminal] started new server\n  wsUrl=${wsUrl}\n  ${LOG_FILE} tail:\n${logTail.result}`
  )

  return {
    status: "running",
    websocketUrl: wsUrl,
    httpsUrl: signedUrl.url,
    port,
  }
}
