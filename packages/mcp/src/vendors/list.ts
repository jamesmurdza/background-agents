/**
 * Vendors whose own hosted MCP server we connect to directly over OAuth.
 *
 * Each one was checked with a real login: its authorization server lets a
 * new client register itself (dynamic client registration), so connecting
 * needs no OAuth app set up by hand. Vendors that only accept approved
 * clients or redirect URIs (Figma, Intercom, and Vercel and Canva, which only
 * allow localhost without approval) or need an app registered with them
 * (e.g. Slack) aren't listed.
 */

export interface McpVendor {
  /** URL-safe id, used in routes (`/api/mcp/connect/<slug>`). */
  slug: string
  name: string
  description: string
  /** The vendor's hosted MCP endpoint. */
  mcpUrl: string
  /** The vendor's own favicon. */
  iconUrl: string
}

export const MCP_VENDORS: readonly McpVendor[] = [
  {
    slug: "linear",
    name: "Linear",
    description: "Issues, projects and cycles in Linear",
    mcpUrl: "https://mcp.linear.app/mcp",
    iconUrl: "https://linear.app/favicon.ico",
  },
  {
    slug: "notion",
    name: "Notion",
    description: "Search, read and edit Notion pages",
    mcpUrl: "https://mcp.notion.com/mcp",
    iconUrl: "https://www.notion.so/images/favicon.ico",
  },
  {
    slug: "sentry",
    name: "Sentry",
    description: "Errors, issues and releases in Sentry",
    mcpUrl: "https://mcp.sentry.dev/mcp",
    iconUrl: "https://sentry.io/favicon.ico",
  },
  {
    slug: "atlassian",
    name: "Atlassian",
    description: "Jira issues and Confluence pages",
    mcpUrl: "https://mcp.atlassian.com/v1/mcp",
    iconUrl: "https://www.atlassian.com/favicon.ico",
  },
  {
    slug: "supabase",
    name: "Supabase",
    description: "Projects, databases and edge functions in Supabase",
    mcpUrl: "https://mcp.supabase.com/mcp",
    iconUrl: "https://supabase.com/favicon/favicon.ico",
  },
  {
    slug: "neon",
    name: "Neon",
    description: "Neon Postgres projects, branches and SQL",
    mcpUrl: "https://mcp.neon.tech/mcp",
    iconUrl: "https://neon.tech/favicon/favicon.png",
  },
  {
    slug: "cloudflare",
    name: "Cloudflare",
    description: "Workers, KV, R2 and D1 in your Cloudflare account",
    mcpUrl: "https://bindings.mcp.cloudflare.com/mcp",
    iconUrl: "https://www.cloudflare.com/favicon.ico",
  },
  {
    slug: "huggingface",
    name: "Hugging Face",
    description: "Search models, datasets and Spaces on Hugging Face",
    mcpUrl: "https://huggingface.co/mcp",
    iconUrl: "https://huggingface.co/favicon.ico",
  },
  {
    slug: "monday",
    name: "monday.com",
    description: "Boards and items in monday.com",
    mcpUrl: "https://mcp.monday.com/mcp",
    iconUrl: "https://monday.com/favicon.ico",
  },
  {
    slug: "exa",
    name: "Exa",
    description: "Web search and page fetching via Exa",
    mcpUrl: "https://mcp.exa.ai/mcp",
    iconUrl: "https://exa.ai/images/favicon-32x32.png",
  },
  {
    slug: "paddle",
    name: "Paddle",
    description: "Billing, subscriptions and customers in Paddle",
    mcpUrl: "https://mcp.paddle.com/mcp",
    iconUrl: "https://www.paddle.com/favicon.ico",
  },
  {
    slug: "context7",
    name: "Context7",
    description: "Up-to-date library documentation",
    mcpUrl: "https://mcp.context7.com/mcp",
    iconUrl: "https://context7.com/favicon.ico",
  },
]

const BY_SLUG = new Map(MCP_VENDORS.map((v) => [v.slug, v]))
const BY_QUALIFIED_NAME = new Map(MCP_VENDORS.map((v) => [vendorQualifiedName(v), v]))

/** The McpServerConnection.qualifiedName for a vendor, e.g. "linear/linear". */
export function vendorQualifiedName(vendor: Pick<McpVendor, "slug">): string {
  return `${vendor.slug}/${vendor.slug}`
}

export function findMcpVendor(slug: string): McpVendor | undefined {
  return BY_SLUG.get(slug)
}

export function findMcpVendorByQualifiedName(qualifiedName: string): McpVendor | undefined {
  return BY_QUALIFIED_NAME.get(qualifiedName)
}
