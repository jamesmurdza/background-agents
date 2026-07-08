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
 * Command shown when the chat has no linked repository yet
 */
export const CREATE_REPO_COMMAND: SlashCommand = {
  name: "repo",
  label: "Repository",
  description: "Create repository",
  icon: "FolderGit2",
}

/**
 * Filter a single command by prefix-matching the input against its name.
 * Used when the chat has no linked repo and only the create-repo command applies.
 * @param input - The current input (with or without leading slash)
 * @param cmd - The single command to match against
 * @returns The command wrapped in an array if it matches, otherwise an empty array
 */
export function filterSingleCommand(input: string, cmd: SlashCommand): SlashCommand[] {
  const filter = input.startsWith("/") ? input.slice(1).toLowerCase() : input.toLowerCase()
  if (!filter) return [cmd]
  // Match the typed-in prefix against the command name.
  return cmd.name.toLowerCase().startsWith(filter) ? [cmd] : []
}

/**
 * Simple fuzzy match for filtering commands
 * Returns true if all characters in the filter appear in order in the target
 */
function fuzzyMatch(filter: string, target: string): boolean {
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
