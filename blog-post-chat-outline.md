# Blog Post Outline: Building a Chat Interface for Cloud Coding Agents

## Title Ideas
- "Building a Chat Interface for Cloud Coding Agents"
- "From SDK to UI: Building a Chat Interface for Coding Agents"

---

## Opening (2 paragraphs)

**Paragraph 1**: The Background Agents SDK lets you run coding agents in cloud sandboxes. But to build a real application, you need a way to display the agent's output, handle the polling loop, and let users interact with the results.

**Paragraph 2**: I built an example chat application to show how this works. It's a Next.js app with no database—just local storage—so you can see how the pieces connect without extra complexity.

---

## Section: The Polling Loop

The core of the chat interface is a polling loop that fetches events and renders them progressively.

- Code example: basic polling loop in React/Next.js
- Explain accumulating events and updating state
- Brief mention of polling interval (1 second)

---

## Section: Rendering Events

Different event types need different UI treatments:

- `token` → append to message text (streaming effect)
- `tool_start` → show tool name and input (collapsible?)
- `tool_delta` → stream tool output
- `tool_end` → show final result
- `end` → stop polling

Maybe include a simple React component example or pseudocode.

---

## Section: Git Integration

Each conversation is tied to a git branch. This gives you:

- Isolation: experiments don't touch main
- History: changes are tracked
- Workflow: `/commit` and `/pr` commands

Brief code or explanation of how branches are created per chat.

---

## Section: Slash Commands

The chat supports slash commands that trigger actions:

- `/commit` — agent writes a commit message
- `/pr` — opens a pull request on GitHub

These work because the GitHub token is held by the app, not the sandbox.

---

## Conclusion (1 paragraph)

The chat interface is intentionally minimal to show the pattern. The key pieces: a polling loop, progressive rendering of events, and git integration for a natural workflow. The full source is available on GitHub.

---

## Style Notes (from previous post)

- Direct, practical tone
- Short paragraphs
- Code examples broken into chunks with text between
- Use "I" not "we"
- No fluff, focus on what it does and how
- End with link to source

---

## Questions for you

1. Should this focus more on the UI/React side or keep it higher-level?
2. Include screenshots or just code?
3. How much overlap with the SDK post is okay? (e.g., event types are already covered there)
4. Should I name the app "Simple Chat" or keep it as "example chat application"?
