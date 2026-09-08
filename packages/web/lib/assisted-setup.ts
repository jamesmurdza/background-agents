// Handoff for "Set up with agent": the prompt is built at click time in the
// environment editor (repo and environment name are already on hand there)
// and stashed against the id of the chat the button just created, then
// consumed once by the chat page after navigation.
//
// Same sessionStorage-handoff shape as lib/pending-message.ts (which stages a
// message across the sign-in redirect), keyed by chat id instead of "whichever
// chat comes next": this flow always knows its target chat before it navigates,
// so there's no need for the two-effect "wait for the chat to exist" dance
// that flow needs.
//
// A separate module from setup-script.ts on purpose: that file pulls in
// Node's `crypto` and the sandbox-jobs package for its sandbox-side helpers,
// neither of which belongs in a client bundle. This one has no imports at all.

const KEY_PREFIX = "simple-chat-assisted-setup:"

export function stageAssistedSetupPrompt(chatId: string, prompt: string): void {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(`${KEY_PREFIX}${chatId}`, prompt)
  } catch {
    /* sessionStorage unavailable (private browsing, quota); the chat still
     * opens, it just won't auto-send the seed prompt. */
  }
}

/** Reads and clears the staged prompt for a chat, or null if there is none. */
export function consumeAssistedSetupPrompt(chatId: string): string | null {
  if (typeof window === "undefined") return null
  const key = `${KEY_PREFIX}${chatId}`
  try {
    const prompt = sessionStorage.getItem(key)
    if (prompt !== null) sessionStorage.removeItem(key)
    return prompt
  } catch {
    return null
  }
}
