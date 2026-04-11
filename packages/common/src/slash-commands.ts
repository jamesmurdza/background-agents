/**
 * Slash command definitions for git actions
 * Shared between web and simple-chat packages
 */

export interface SlashCommand {
  /** Command name without the leading slash */
  name: string
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
    description: "Merge branches",
    icon: "GitMerge",
  },
  {
    name: "rebase",
    description: "Rebase onto another branch",
    icon: "GitBranch",
  },
  {
    name: "pr",
    description: "Create a pull request",
    icon: "GitPullRequest",
  },
]

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
