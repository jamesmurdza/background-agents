/**
 * Claude Code permission renderer.
 *
 * Claude Code supports a `PreToolUse` bash hook that runs before each command.
 * The hook receives the command as JSON on stdin and blocks execution by
 * exiting with code 2. This module renders a `CommandPolicy` into that hook
 * script and installs it into the sandbox.
 */

import type { Sandbox } from "@daytonaio/sdk"
import type { CommandPolicy, CommandRule } from "./types"

/** Claude hooks directory path in the sandbox. */
export const CLAUDE_HOOKS_DIR = "/home/daytona/.claude/hooks"

/** Claude pre-command hook file path. */
export const CLAUDE_HOOK_FILE = `${CLAUDE_HOOKS_DIR}/prevent-dangerous-git.sh`

/** Claude settings file path. */
export const CLAUDE_SETTINGS_FILE = "/home/daytona/.claude/settings.json"

/**
 * Claude settings fragment that registers the pre-command hook. Merged into any
 * existing settings.json so we don't clobber user config.
 */
export const CLAUDE_SETTINGS = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: CLAUDE_HOOK_FILE }],
      },
    ],
  },
} as const

// Matches the start of a (sub)command: line start or a shell separator.
const LEAD = "(^|&&|;|\\|)\\s*"

/** Escape characters that are regex metacharacters inside an ERE pattern. */
function escapeRe(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Build the `git\s+commit` style prefix fragment from prefix tokens. */
function prefixPattern(prefix: string[]): string {
  return prefix.map(escapeRe).join("\\s+")
}

function blockSnippet(condition: string, reason: string): string {
  return `if ${condition}; then\n  echo "Blocked: ${reason}" >&2\n  exit 2\nfi`
}

function grep(pattern: string): string {
  return `echo "$COMMAND" | grep -qE '${pattern}'`
}

/** Render a single rule into a bash `if` block that exits 2 to block. */
function renderRule(rule: CommandRule): string {
  const pfx = prefixPattern(rule.prefix)
  switch (rule.kind) {
    case "deny":
      return blockSnippet(grep(`${LEAD}${pfx}`), rule.reason)
    case "deny-with-flag": {
      const flags = rule.flags.map(escapeRe).join("|")
      return blockSnippet(grep(`${LEAD}${pfx}\\s+[^|;&]*(${flags})`), rule.reason)
    }
    case "deny-except": {
      const allow = rule.allow
        .map((a) => escapeRe(a.replace(/^--/, "")))
        .join("|")
      return [
        `if ${grep(`${LEAD}${pfx}`)}; then`,
        `  if ${grep(`${pfx}\\s+--(${allow})`)}; then`,
        `    : # allow conflict-resolution / continuation forms`,
        `  else`,
        `    echo "Blocked: ${rule.reason}" >&2`,
        `    exit 2`,
        `  fi`,
        `fi`,
      ].join("\n")
    }
    case "deny-branch-arg": {
      if (rule.allowFileForms) {
        // Block `git checkout <branch>` but allow `.`, `-- <file>`, `HEAD`.
        return [
          `if ${grep(`${LEAD}${pfx}\\s+[a-zA-Z][a-zA-Z0-9_/.-]*\\s*($|&&|;|\\|)`)}; then`,
          `  if ! ${grep(`${LEAD}${pfx}\\s+(HEAD|HEAD~|--)`)}; then`,
          `    echo "Blocked: ${rule.reason}" >&2`,
          `    exit 2`,
          `  fi`,
          `fi`,
        ].join("\n")
      }
      return blockSnippet(grep(`${LEAD}${pfx}\\s+[a-zA-Z0-9_/.-]+`), rule.reason)
    }
  }
}

/** Render a `CommandPolicy` into the full Claude pre-command hook script. */
export function renderClaudeHook(policy: CommandPolicy): string {
  const blocks = policy.deny.map(renderRule).join("\n\n")
  return `#!/bin/bash
# Auto-generated hook to enforce the command permission policy.
# Runs before every Bash command; exits 2 to block, 0 to allow.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

${blocks}

exit 0
`
}

/**
 * Install the rendered Claude hook into a Daytona sandbox and register it in
 * ~/.claude/settings.json (merging so we don't clobber existing config).
 */
export async function setupClaudePermissions(
  sandbox: Sandbox,
  policy: CommandPolicy
): Promise<void> {
  await sandbox.process.executeCommand(`mkdir -p ${CLAUDE_HOOKS_DIR}`)

  await sandbox.fs.uploadFile(
    Buffer.from(renderClaudeHook(policy), "utf-8"),
    CLAUDE_HOOK_FILE
  )

  await sandbox.process.executeCommand(`chmod +x ${CLAUDE_HOOK_FILE}`)

  const existingResult = (await sandbox.process.executeCommand(
    `cat "${CLAUDE_SETTINGS_FILE}" 2>/dev/null || echo '{}'`
  )) as { result: string }
  const existing = JSON.parse(existingResult.result.trim() || "{}") as {
    hooks?: Record<string, Array<Record<string, unknown>>>
  }

  if (!existing.hooks) existing.hooks = {}
  for (const [event, handlers] of Object.entries(CLAUDE_SETTINGS.hooks)) {
    if (!existing.hooks[event]) existing.hooks[event] = []
    for (const handler of handlers) {
      const alreadyRegistered = existing.hooks[event].some(
        (current) => JSON.stringify(current) === JSON.stringify(handler)
      )
      if (!alreadyRegistered) {
        existing.hooks[event].push(handler as Record<string, unknown>)
      }
    }
  }

  await sandbox.fs.uploadFile(
    Buffer.from(JSON.stringify(existing, null, 2), "utf-8"),
    CLAUDE_SETTINGS_FILE
  )

  await sandbox.process.executeCommand(`chmod 600 ${CLAUDE_SETTINGS_FILE}`)
}
