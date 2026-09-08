/**
 * Dismissal for the "agent updated the setup script" notice.
 *
 * Keyed by (chatId, scriptHash) rather than just chatId: dismissing today's
 * edit must not swallow a later, different edit on the same chat, and the
 * hash is exactly what changes between them (see ScriptUpdateNotice in
 * lib/setup-script.ts). Deliberately free of React and of localStorage
 * itself, same reasoning as lib/credit-warning.ts: the key is a pure function
 * of its inputs, which is what makes it testable without a DOM.
 */

export function scriptNoticeDismissalKey(chatId: string, scriptHash: string): string {
  return `setup-script-notice-dismissed:${chatId}:${scriptHash}`
}
