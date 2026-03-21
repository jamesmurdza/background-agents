/**
 * Claude Code hooks configuration
 * Sets up hooks that run during Claude Code execution to enforce rules
 */

import { PATHS } from "@/lib/constants"

/**
 * Hook script that prevents git commit --amend operations.
 * This ensures agents always create new commits instead of amending.
 */
const PREVENT_GIT_AMEND_HOOK = `#!/bin/bash
# Hook to prevent git commit --amend operations
# This hook is triggered before any Bash command executes

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Check for git commit --amend at the START of a command or after && or ;
# This prevents false positives from commit messages or heredocs that mention --amend
# Patterns matched:
#   - git commit --amend
#   - git commit -a --amend
#   - git commit --amend -m "msg"
#   - cd foo && git commit --amend
#   - something; git commit --amend
if echo "$COMMAND" | grep -qE '(^|&&|;)\\s*git\\s+commit\\s+(--amend|[^|;]*\\s--amend)'; then
  echo "Blocked: git commit --amend is not allowed. Please create a new commit instead." >&2
  exit 2
fi

exit 0
`

/**
 * Claude Code settings.json with hooks configuration
 */
const CLAUDE_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: `${PATHS.CLAUDE_HOOKS_DIR}/prevent-git-amend.sh`,
          },
        ],
      },
    ],
  },
}

/**
 * Returns a shell command that sets up Claude Code hooks in the sandbox.
 * Creates the hooks directory, writes the hook scripts, and configures settings.json.
 */
export function getClaudeHooksSetupCommand(): string {
  // Base64 encode the hook script to avoid shell escaping issues
  const hookScriptB64 = Buffer.from(PREVENT_GIT_AMEND_HOOK).toString("base64")
  const settingsB64 = Buffer.from(JSON.stringify(CLAUDE_SETTINGS, null, 2)).toString("base64")

  // Create directory, write hook script, make it executable, and write settings
  // We use a merge strategy for settings.json to preserve any existing settings
  return `
    mkdir -p ${PATHS.CLAUDE_HOOKS_DIR} && \
    echo '${hookScriptB64}' | base64 -d > ${PATHS.CLAUDE_HOOKS_DIR}/prevent-git-amend.sh && \
    chmod +x ${PATHS.CLAUDE_HOOKS_DIR}/prevent-git-amend.sh && \
    existing_settings=$(cat ${PATHS.CLAUDE_SETTINGS_FILE} 2>/dev/null || echo '{}') && \
    new_settings=$(echo '${settingsB64}' | base64 -d) && \
    node -e "
      const existing = JSON.parse(process.argv[1] || '{}');
      const newSettings = JSON.parse(process.argv[2] || '{}');
      // Deep merge hooks
      if (!existing.hooks) existing.hooks = {};
      for (const [event, handlers] of Object.entries(newSettings.hooks || {})) {
        if (!existing.hooks[event]) existing.hooks[event] = [];
        // Add new handlers that don't already exist (by command)
        for (const handler of handlers) {
          const exists = existing.hooks[event].some(h =>
            JSON.stringify(h) === JSON.stringify(handler)
          );
          if (!exists) existing.hooks[event].push(handler);
        }
      }
      console.log(JSON.stringify(existing, null, 2));
    " "\${existing_settings}" "\${new_settings}" > ${PATHS.CLAUDE_SETTINGS_FILE}.tmp && \
    mv ${PATHS.CLAUDE_SETTINGS_FILE}.tmp ${PATHS.CLAUDE_SETTINGS_FILE} && \
    chmod 600 ${PATHS.CLAUDE_SETTINGS_FILE}
  `.trim().replace(/\n\s+/g, " ")
}
