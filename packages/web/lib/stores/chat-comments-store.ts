import { create } from "zustand"

/**
 * Comments from the Changes panel and Select element, shown as cards above the
 * chat input until the next message sends them. Like attached files, they
 * aren't kept across a reload.
 */
export interface PendingComment {
  id: string
  /** Short location for the card, e.g. `main.jsx:91-95`. */
  label: string
  /** What the comment is about. Quoted in the message. */
  context: string
  comment: string
}

interface ChatCommentsState {
  byChat: Record<string, PendingComment[]>
  addComment: (chatId: string, comment: Omit<PendingComment, "id">) => void
  removeComment: (chatId: string, id: string) => void
  clearComments: (chatId: string) => void
}

let nextId = 0

export const useChatCommentsStore = create<ChatCommentsState>((set) => ({
  byChat: {},
  addComment: (chatId, comment) => {
    const added = { ...comment, id: `comment-${++nextId}`, comment: comment.comment.trim() }
    set((state) => ({ byChat: { ...state.byChat, [chatId]: [...(state.byChat[chatId] ?? []), added] } }))
  },
  removeComment: (chatId, id) =>
    set((state) => ({
      byChat: { ...state.byChat, [chatId]: (state.byChat[chatId] ?? []).filter((c) => c.id !== id) },
    })),
  clearComments: (chatId) =>
    set((state) => {
      const byChat = { ...state.byChat }
      delete byChat[chatId]
      return { byChat }
    }),
}))

/** The message to send: each comment under its quoted context, then whatever was typed. */
export function withPendingComments(input: string, comments: PendingComment[]): string {
  const quoted = comments.map(({ context, comment }) => {
    const quote = context.split("\n").map((line) => `> ${line}`).join("\n")
    return `${quote}\n\n${comment}`
  })
  return [...quoted, input.trim()].filter(Boolean).join("\n\n")
}
