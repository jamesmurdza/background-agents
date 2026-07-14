/**
 * TOML section helpers for ~/.codex/config.toml.
 *
 * The Codex config file has two independent owners that each do whole-file
 * writes: the MCP layer (@background-agents/agent-configuration) writes the
 * `[mcp_servers.*]` sections, while codexSetup writes the provider/routing
 * config (the top-level `model_provider`/`model` keys and `[model_providers.*]`
 * sections). setupMcpForAgent runs first, then codexSetup runs last — so
 * codexSetup must carry the MCP sections across its own rewrite instead of
 * clobbering them. These helpers do that section-preserving carry-over.
 */

/**
 * Extract top-level TOML sections whose dotted header starts with one of the
 * given prefixes. A "section" is a `[header]` line plus every following line up
 * to (but not including) the next top-level `[header]`. Blocks are returned in
 * their original order with inner formatting preserved and trailing whitespace
 * trimmed; the preamble (top-level key/value lines before the first section) is
 * never included.
 *
 * A prefix matches a header that equals it exactly or that begins with
 * `prefix + "."` — so `["mcp_servers"]` keeps `[mcp_servers.github]` and its
 * sub-tables but not `[model_providers.custom]`.
 *
 * Assumes the simple config this app generates (string / inline-table values,
 * no multi-line TOML arrays whose continuation lines could look like a
 * `[header]`). Both writers emit that shape, so the assumption holds.
 */
export function extractTomlSections(content: string, prefixes: string[]): string {
  const isOwned = (header: string) =>
    prefixes.some((p) => header === p || header.startsWith(`${p}.`))

  const blocks: string[] = []
  let current: string[] | null = null

  const flush = () => {
    if (current) blocks.push(current.join("\n").replace(/\s+$/, ""))
    current = null
  }

  for (const line of content.split("\n")) {
    const match = line.match(/^\s*\[\s*([^[\]]+?)\s*\]\s*$/)
    if (match) {
      // New top-level section header — close out the previous block and start a
      // new one only if this header is owned by a requested prefix.
      flush()
      current = isOwned(match[1].trim()) ? [line] : null
    } else if (current) {
      current.push(line)
    }
    // Lines outside any owned section (incl. the preamble) are dropped.
  }
  flush()

  return blocks.join("\n\n")
}

/**
 * Combine a provider-config TOML string with preserved foreign sections (e.g.
 * `[mcp_servers.*]`) into the final config.toml contents. Empty parts are
 * dropped; the provider config comes first so its top-level preamble keys stay
 * above every section header (required by TOML). Returns "" when both parts are
 * empty, signalling the file should be removed rather than written.
 */
export function combineCodexConfig(providerToml: string, preserved: string): string {
  const parts = [providerToml.trim(), preserved.trim()].filter(Boolean)
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : ""
}
