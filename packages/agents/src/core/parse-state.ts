/**
 * Typed, per-agent parser state.
 *
 * `ParseContext.state` is an intentionally untyped `Record<string, unknown>`
 * bag shared by every parser so a single context can host multiple agents.
 * Reaching into it directly forces unsafe casts (`ctx.state[KEY] as Set<...>`)
 * scattered across each parser.
 *
 * `getParserState` confines that cast to one place: an agent declares a state
 * class and looks it up under its own namespaced key. The object is created
 * lazily on first access and reused for the rest of the session.
 */

import type { ParseContext } from "./agent"

/**
 * Lazily initialise and return the typed state object stored on
 * `context.state[key]`. Each agent passes a distinct `key` so their state
 * objects never collide on a shared context.
 *
 * @param context - The parse context carrying the shared state bag.
 * @param key - Namespaced key identifying this agent's state slot.
 * @param create - Factory invoked once to build the initial state.
 */
export function getParserState<T extends object>(
  context: ParseContext,
  key: string,
  create: () => T
): T {
  const existing = context.state[key]
  if (existing) return existing as T
  const created = create()
  context.state[key] = created
  return created
}
