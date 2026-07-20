# Skills

Skills are packaged, repo-scoped abilities you install into a project from the [skills.sh](https://skills.sh) marketplace — a deploy checklist, a review workflow, a framework-specific helper. Once installed, the agent can invoke a skill during a chat in that repo.

Where [MCP servers](#/mcp) give an agent new *tools*, skills give it new *procedures* — packaged instructions for a specific kind of task.

:::media type="gif" file="skill-install.gif" duration="~25s"
Searching the skills.sh marketplace, installing a skill into the repo, and seeing it become available to the agent.
:::

## Install a skill

From the skills panel, search the marketplace and install the one you want. Installation happens inside the sandbox against the connected repository, so the skill is scoped to that project.

:::media type="image" file="skills-list.png"
The skills panel: installed skills for this repo, with search to add more from skills.sh.
:::

## Use a skill

Once installed, mention the task the skill covers and the agent will reach for it — for example, "run the deploy checklist" or "review this diff using our review skill." Skills stay available for the repo, so later chats can use them too.

## Manage skills

Skills can be listed, installed, and uninstalled per repository. Remove ones you no longer use to keep the agent focused on the procedures that matter.

> [!TIP]
> Skills shine for **repeatable, opinionated workflows** unique to your project. If you find yourself pasting the same multi-step instructions into every chat, that's a skill waiting to be packaged.

## Skills vs MCP — which do I want?

| Use a **skill** when… | Use an **MCP server** when… |
|-----------------------|-----------------------------|
| You want a repeatable *procedure* (checklist, workflow). | You want a new *capability* (search, GitHub, a DB). |
| It's specific to one repo. | It's a shared external service. |
| It's mostly instructions/prompts. | It's an API the agent calls. |

They compose — a skill can tell the agent to use MCP tools as part of its procedure.

## Next

- Give the agent tools to go with its procedures → [MCP servers](#/mcp)
- Put a skill to work end to end → [Build a mini-game](#/mini-game)
