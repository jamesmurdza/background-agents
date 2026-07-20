# Build a mini-game

**Goal:** in a single chat session, have an agent build a small interactive browser toy — here, a physics gravity sandbox — run it in the sandbox, and play with it in a live preview.

This is the fun one. It shows off sandbox isolation, the built-in terminal, and branch-per-chat without touching your machine.

:::media type="video" file="gravity-game.mp4" duration="~2m10s"
From a one-line prompt to a playable toy: the agent scaffolds a self-contained page, starts a static server in the sandbox terminal, and the gravity sandbox loads in preview — drag to spawn shapes, watch them fall and collide.
:::

## Prerequisites

- A model credential for your chosen agent.
- No repo required — you can start from an empty sandbox and export the code afterward, or connect a repo to keep it.

## Step 1 — Start a chat and pick an agent

Create a new chat. Any capable coding agent works; pick your model from the selector.

## Step 2 — Ask for it

Be concrete about the stack so it stays simple and self-contained:

```text
Build an interactive 2D physics gravity sandbox in a single self-contained
index.html using vanilla JavaScript and a <canvas> — no build step, no
dependencies, no npm. Write your own simple physics (gravity, velocity,
collision) — do not pull in a physics library.

Behavior:
- Click and drag to draw a shape (a circle or box); on release it drops and
  obeys gravity.
- Shapes collide with each other and with the floor and walls, bouncing with a
  bit of energy loss so they settle realistically.
- Throw a shape by flicking the mouse — it keeps the drag momentum.
- A toolbar to pick shape type, size, and color, plus a "Clear" button.
- Dark background, soft shadows, smooth 60fps.

Then start a static server so I can play with it.
```

The agent writes the files and streams its work as it goes.

## Step 3 — Run it in the sandbox

The agent starts a static server in the sandbox's terminal. Because everything runs inside Daytona, there's nothing to install locally and nothing that can affect your machine.

:::media type="image" file="preview-running.png"
The finished sandbox running in the preview pane — drag to spawn shapes, watch them tumble and settle.
:::

## Step 4 — Iterate

Keep the chat going to refine it:

- "Add a gravity-direction control so I can flip gravity sideways or off."
- "Let me grab and fling existing shapes, not just new ones."
- "Add springy links between two shapes I click."

Each request edits the same branch, so the toy evolves in place.

> [!TIP]
> Ask for a **single self-contained HTML file** with no build step. It's the fastest thing to preview, the easiest to share, and it keeps the agent from getting lost in tooling.

## Keep it

If you [connected a repo](#/github), have the agent open a pull request so the toy lands on a branch you can merge or share.

## Next

- Compare how different agents build the same thing → [Agent Battle](#/agent-battle)
- Give the agent a data source or extra tools → [MCP servers](#/mcp)
