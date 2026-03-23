# Codex rules to prevent dangerous git operations
# These rules block commands that rewrite history, push, or manipulate branches
#
# Note: Codex uses prefix_rule() which matches command prefixes.
# We cannot use wildcards/regex, so we list common branch name patterns.
# The system prompt tells agents to use "git restore" for file operations.

# Block git commit --amend (history rewriting)
prefix_rule(
    pattern=["git", "commit", "--amend"],
    decision="forbidden",
    justification="git commit --amend rewrites history. Create a new commit instead.",
)

prefix_rule(
    pattern=["git", "commit", "-a", "--amend"],
    decision="forbidden",
    justification="git commit --amend rewrites history. Create a new commit instead.",
)

# Block git rebase (history rewriting)
prefix_rule(
    pattern=["git", "rebase"],
    decision="forbidden",
    justification="git rebase rewrites history and is not allowed.",
)

# Block git reset --hard (history rewriting)
prefix_rule(
    pattern=["git", "reset", "--hard"],
    decision="forbidden",
    justification="git reset --hard rewrites history and is not allowed.",
)

# Block git push (handled automatically)
prefix_rule(
    pattern=["git", "push"],
    decision="forbidden",
    justification="git push is not allowed. Pushing is handled automatically.",
)

# Block git branch -d/-D (branch deletion)
prefix_rule(
    pattern=["git", "branch", "-d"],
    decision="forbidden",
    justification="Deleting branches is not allowed.",
)

prefix_rule(
    pattern=["git", "branch", "-D"],
    decision="forbidden",
    justification="Deleting branches is not allowed.",
)

# Block git branch -m/-M (branch renaming)
prefix_rule(
    pattern=["git", "branch", "-m"],
    decision="forbidden",
    justification="Renaming branches is not allowed.",
)

prefix_rule(
    pattern=["git", "branch", "-M"],
    decision="forbidden",
    justification="Renaming branches is not allowed.",
)

# Block git checkout -b (branch creation)
prefix_rule(
    pattern=["git", "checkout", "-b"],
    decision="forbidden",
    justification="Creating new branches is not allowed.",
)

# Block git switch -c (branch creation)
prefix_rule(
    pattern=["git", "switch", "-c"],
    decision="forbidden",
    justification="Creating new branches is not allowed.",
)

# Block git switch <branch> (branch switching)
# Common branch names and patterns
prefix_rule(
    pattern=["git", "switch", "main"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "master"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "develop"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "dev"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "staging"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "production"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "feature/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "bugfix/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "hotfix/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "switch", "release/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

# Block git checkout <branch> (branch switching)
# Common branch names and patterns
prefix_rule(
    pattern=["git", "checkout", "main"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "master"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "develop"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "dev"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "staging"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "production"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "feature/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "bugfix/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "hotfix/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)

prefix_rule(
    pattern=["git", "checkout", "release/"],
    decision="forbidden",
    justification="Switching branches is not allowed. Stay on the current branch.",
)
