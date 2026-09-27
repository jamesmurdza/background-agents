/**
 * Default hard timeouts for agent runs, in minutes, shared between the
 * agent-lifecycle cron (app/api/cron/agent-lifecycle/_lib/constants, which
 * re-exports these) and the Settings > Developer UI (DeveloperSection),
 * which shows them as the "default" an admin's maxAgentRunMinutes override
 * replaces. Kept here, outside both, so the two never drift apart — this has
 * no "server-only" import specifically so the client settings UI can read it
 * directly instead of hardcoding the same numbers as display copy.
 */
export const INTERACTIVE_HARD_TIMEOUT_MINUTES = 25
export const SCHEDULED_HARD_TIMEOUT_MINUTES = 20
