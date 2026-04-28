/**
 * Slash command definitions for git actions
 * Shared between web and simple-chat packages
 */

export interface SlashCommand {
  /** Command name without the leading slash */
  name: string
  /** Display label for the command */
  label: string
  /** Human-readable description */
  description: string
  /** Icon name (lucide-react icon) */
  icon: string
}

/**
 * Available slash commands for git operations
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "merge",
    label: "Merge",
    description: "Merge this branch into another",
    icon: "GitMerge",
  },
  {
    name: "rebase",
    label: "Rebase",
    description: "Rebase this branch onto another",
    icon: "GitBranch",
  },
  {
    name: "pr",
    label: "Pull Request",
    description: "Create a pull request",
    icon: "GitPullRequest",
  },
  {
    name: "squash",
    label: "Squash",
    description: "Squash commits into one",
    icon: "GitCommitVertical",
  },
  {
    name: "branch",
    label: "Branch",
    description: "Create a new chat from here",
    icon: "GitBranchPlus",
  },
]

/**
 * Abort command - only shown during conflict
 */
export const ABORT_COMMAND: SlashCommand = {
  name: "abort",
  label: "Abort",
  description: "Abort the current merge or rebase",
  icon: "XCircle",
}

/**
 * Simple fuzzy match for filtering commands
 * Returns true if all characters in the filter appear in order in the target
 */
export function fuzzyMatch(filter: string, target: string): boolean {
  const filterLower = filter.toLowerCase()
  const targetLower = target.toLowerCase()

  let filterIndex = 0
  for (let i = 0; i < targetLower.length && filterIndex < filterLower.length; i++) {
    if (targetLower[i] === filterLower[filterIndex]) {
      filterIndex++
    }
  }

  return filterIndex === filterLower.length
}

/**
 * Filter slash commands based on user input
 * @param input - The current input (with or without leading slash)
 * @returns Filtered list of matching commands
 */
export function filterSlashCommands(input: string): SlashCommand[] {
  // Remove leading slash if present
  const filter = input.startsWith("/") ? input.slice(1) : input

  if (!filter) {
    return SLASH_COMMANDS
  }

  return SLASH_COMMANDS.filter((cmd) => fuzzyMatch(filter, cmd.name))
}

/**
 * Commands to hide during an active conflict
 */
const CONFLICT_BLOCKED_COMMANDS = ["merge", "rebase", "pr"]

/**
 * Filter slash commands based on user input and conflict state
 * @param input - The current input (with or without leading slash)
 * @param inConflict - Whether we're currently in a merge/rebase conflict
 * @returns Filtered list of matching commands
 */
export function filterSlashCommandsWithConflict(
  input: string,
  inConflict: boolean
): SlashCommand[] {
  // Remove leading slash if present
  const filter = input.startsWith("/") ? input.slice(1) : input

  // Build command list based on conflict state
  let commands: SlashCommand[]
  if (inConflict) {
    // During conflict: show abort, hide merge/rebase/pr
    commands = [
      ABORT_COMMAND,
      ...SLASH_COMMANDS.filter((cmd) => !CONFLICT_BLOCKED_COMMANDS.includes(cmd.name)),
    ]
  } else {
    // Normal state: show all except abort
    commands = SLASH_COMMANDS
  }

  if (!filter) {
    return commands
  }

  return commands.filter((cmd) => fuzzyMatch(filter, cmd.name))
}
