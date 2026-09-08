/**
 * Pure setup-script constants and prompt text.
 *
 * Split out of lib/setup-script.ts, which pulls in Node's `crypto` and the
 * `@background-agents/sandbox-jobs` package for its sandbox-side helpers.
 * Neither belongs in a browser bundle, so anything a client component needs
 * (the sandbox path, the "Set up with agent" seed prompt) lives here instead,
 * where the only exports are strings and a pure function. setup-script.ts
 * re-exports these so server code importing from there sees no difference.
 */

export const SETUP_DIR = "/home/daytona/.backgrounder"
export const SETUP_SCRIPT_PATH = `${SETUP_DIR}/setup.sh`

/**
 * The opening prompt for a "Set up with agent" chat.
 *
 * Says the path explicitly, insists the script is actually run rather than
 * merely written, and forbids inlining secrets: the script is stored
 * unencrypted, and the user deliberately did not hand the agent their values.
 */
export function buildAssistedSetupPrompt(repo: string, environmentName: string): string {
  return [
    `Set up the development environment for ${repo} (environment: "${environmentName}").`,
    "",
    `Write a setup script at ${SETUP_SCRIPT_PATH} that installs this project's`,
    "dependencies and leaves it ready to build and run its tests. Then:",
    "",
    "1. Explore the repository first: read the README, package manifests, lockfiles,",
    "   and any CI config, so the script matches how this project is actually built.",
    `2. Write ${SETUP_SCRIPT_PATH}. Start it with \`set -euo pipefail\` so a failing`,
    "   step fails the script instead of being silently skipped.",
    `3. Run it (\`bash ${SETUP_SCRIPT_PATH}\`) and iterate until it succeeds from a`,
    "   clean state, then verify the project builds and its tests run.",
    "",
    "Rules:",
    "- Never put a secret, token, or password in the script. It is stored unencrypted.",
    "  If setup needs one, stop and say which environment variable you need; the user",
    "  will add its value in the environment editor.",
    "- The script runs from the repository directory on a fresh sandbox every time,",
    "  so it must be idempotent and must not assume anything from this session.",
    `- Keep the script at ${SETUP_SCRIPT_PATH}. It is saved back to the environment`,
    "  and reused for every future chat on this repo.",
  ].join("\n")
}
