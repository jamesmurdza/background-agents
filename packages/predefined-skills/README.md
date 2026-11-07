# @background-agents/predefined-skills

Content package for built-in, predefined skills shipped by this app — as
opposed to skills pulled from the skills.sh marketplace or uploaded by a user.

This package holds no installer logic (see `@background-agents/sandbox-skills`
for that). It only holds skill content: one folder per skill, each containing
a `SKILL.md` plus whatever scripts/assets that skill needs.

## Layout

```
packages/predefined-skills/
  browser-mirror/
    SKILL.md
    mirror.js
```

## Installing a predefined skill

Each skill here can be installed the same way as any other `skills`-CLI
source, by pointing at this repo's GitHub tree URL for that subdirectory:

```bash
npx skills add https://github.com/<org>/<repo>/tree/main/packages/predefined-skills/browser-mirror -g
```

This reuses the exact install path already used for marketplace skills
(`installSkill` in `@background-agents/sandbox-skills`) — no new sandbox-side
mechanism is needed.

## Adding a new predefined skill

1. Create a new folder here, e.g. `packages/predefined-skills/my-skill/`.
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description` are
   required — skills without a `description` are skipped by discovery).
3. Add whatever scripts the skill needs alongside it.
4. If the skill needs new npm dependencies, add them to this package's
   `package.json` (`dependencies`), not a per-skill one, unless the skill
   is complex enough to warrant its own.
