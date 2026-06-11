/**
 * @background-agents/background-runner-spike
 *
 * Throwaway experiment comparing two strategies for running and reconnecting to
 * long-running processes in a Daytona sandbox:
 *
 *   - Option C: nohup + files with byte-offset reads and a real exit code.
 *   - Option A: the native Daytona session API.
 *
 * Both implement the same {@link BackgroundRunner} contract, so the harness can
 * drive them identically. If the experiment pans out, the winning runner
 * graduates into a real package.
 */
export type { BackgroundRunner, ReadResult, RunHandle } from "./types.js"
export { FileRunner } from "./file-runner.js"
export { SessionRunner } from "./session-runner.js"
export { observeByReconnecting } from "./harness.js"
export type { ObserveOptions, ReconnectReport } from "./harness.js"
