/**
 * Browser-safe Pi identity shared by discovery, validation and invocation.
 * Backgrounder's Anthropic picker historically stores bare claude-* IDs, while
 * Pi's exact-model registry takes provider + ID. Qualifying that known namespace
 * removes native fuzzy-provider selection; it does not prove model availability
 * or thinking support. The installed registry remains authoritative for those.
 * Unknown/custom patterns keep their native Default behavior at invocation.
 */
export function piModelIdentity(model: string | undefined): string | undefined {
  if (!model) return undefined
  if (/^(?:anthropic|openai|google)\/[a-zA-Z0-9._-]+$/.test(model)) return model
  if (/^claude-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) return `anthropic/${model}`
  return undefined
}
