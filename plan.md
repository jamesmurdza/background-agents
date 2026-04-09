# Plan: Auto-generate English Chat Names

## Goal
Automatically generate human-readable English names for chats based on the user's first message (prompt).

## Current State
- `Chat.displayName` field exists but is always `null`
- UI falls back to "Untitled" when `displayName` is null
- No name generation logic exists

## Approach
Generate chat names **client-side** from the user's first prompt. This keeps it simple without requiring API calls or LLM inference.

### Strategy: Extract key words from the first prompt
1. Take the user's first message
2. Extract meaningful words (skip common words like "a", "the", "please", etc.)
3. Capitalize first letters and join to create a title
4. Limit to ~4-5 words max for readability

### Example Transformations:
- "Build a todo app with React" → "Build Todo App React"
- "Help me create a login page" → "Create Login Page"
- "Fix the bug in the authentication" → "Fix Bug Authentication"
- "Add dark mode to the settings" → "Add Dark Mode Settings"

## Implementation Steps

### Step 1: Create name generation utility
**File:** `packages/simple-chat/lib/utils.ts`

Add a new function `generateChatName(prompt: string): string` that:
- Splits prompt into words
- Filters out common/stop words
- Takes first 4-5 meaningful words
- Capitalizes each word
- Truncates final name to reasonable length (~40 chars)

### Step 2: Set displayName when first message is sent
**File:** `packages/simple-chat/lib/hooks/useChat.ts`

In the `sendMessage` function, after adding the first user message:
- Check if this is the first message (`chat.messages.length === 0`)
- Generate a name using `generateChatName(content)`
- Update the chat with the new `displayName`

### Step 3: No UI changes needed
- ChatPanel already displays `chat.displayName || "Untitled"`
- Sidebar already displays `chat.displayName || "Untitled"`

## Files to Modify
1. `packages/simple-chat/lib/utils.ts` - Add `generateChatName()` function
2. `packages/simple-chat/lib/hooks/useChat.ts` - Call `generateChatName()` on first message

## Stop Words List
Common words to filter out:
```
a, an, the, is, are, was, were, be, been, being,
have, has, had, do, does, did, will, would, could,
should, may, might, must, can, to, of, in, for, on,
with, at, by, from, as, into, through, during, before,
after, above, below, between, under, again, further,
then, once, here, there, when, where, why, how, all,
each, few, more, most, other, some, such, no, nor,
not, only, own, same, so, than, too, very, just,
also, now, please, help, me, i, my, want, need, like
```
