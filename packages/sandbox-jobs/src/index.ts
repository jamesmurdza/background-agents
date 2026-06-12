/**
 * @background-agents/sandbox-jobs
 *
 * Run, observe, and reconnect to long-running shell processes in a Daytona
 * sandbox — using the sandbox filesystem as the durable source of truth, so a
 * cold caller (serverless function, restarted server) can reattach by id and
 * read output incrementally.
 */
export { createSandboxJobs, CANCELLED_EXIT_CODE } from "./jobs"
export { DEFAULT_ROOT } from "./shell"
export type {
  JobHandle,
  JobRead,
  JobState,
  JobStatus,
  SandboxJobs,
  StartJobOptions,
} from "./types"
