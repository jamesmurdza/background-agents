/**
 * Agent Registry
 *
 * A pluggable registry for agent definitions.
 * Replaces the hardcoded switch-based factory.
 */

import type { AgentDefinition } from "./agent.js"

/**
 * Registry for agent definitions.
 * Use the singleton `registry` instance.
 */
class AgentRegistry {
  private agents = new Map<string, AgentDefinition>()

  /**
   * Register an agent definition.
   * @throws Error if agent with same name already registered
   */
  register(agent: AgentDefinition): void {
    if (this.agents.has(agent.name)) {
      throw new Error(`Agent "${agent.name}" is already registered`)
    }
    this.agents.set(agent.name, agent)
  }

  /**
   * Get an agent definition by name.
   */
  get(name: string): AgentDefinition | undefined {
    return this.agents.get(name)
  }

  /**
   * Get all registered agent names.
   */
  getNames(): string[] {
    return Array.from(this.agents.keys())
  }

  /**
   * Check if an agent is registered.
   */
  has(name: string): boolean {
    return this.agents.has(name)
  }

  /**
   * Clear all registered agents (for testing).
   */
  clear(): void {
    this.agents.clear()
  }
}

/** Singleton registry instance */
export const registry = new AgentRegistry()

/**
 * Get an agent definition by name.
 * @throws Error if agent not found
 */
export function getAgent(name: string): AgentDefinition {
  const agent = registry.get(name)
  if (!agent) {
    const available = registry.getNames()
    throw new Error(
      `Unknown agent: "${name}". Available: ${available.length ? available.join(", ") : "(none registered)"}`
    )
  }
  return agent
}

/**
 * Get all registered agent names.
 */
export function getAgentNames(): string[] {
  return registry.getNames()
}
