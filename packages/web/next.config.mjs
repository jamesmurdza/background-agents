import path from "node:path"
import { fileURLToPath } from "node:url"
import { config as loadEnv } from "dotenv"

// Next only loads .env from this directory; Vercel CLI often writes .env at the monorepo root.
// From packages/web, one ".." is packages/ — need ../.. for repo root.
const configDir = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.join(configDir, "..", "..", ".env") })
loadEnv({ path: path.join(configDir, ".env"), override: true })

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NEXT_DIST_DIR && { distDir: process.env.NEXT_DIST_DIR }),
  allowedDevOrigins: [
    "**.daytonaproxy01.net",
  ],
  // Set to true to re-enable Next.js dev indicator
  devIndicators: false,
  images: {
    unoptimized: true,
  },
  // Transpile workspace packages (source imports for dev mode)
  transpilePackages: ["@upstream/agents", "@upstream/common"],
  // Mark native addon packages as external so they're not bundled by webpack
  serverExternalPackages: [
    "ssh2",
    "cpu-features",
  ],
  // Empty turbopack config to acknowledge we're using webpack
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Exclude .node files from webpack bundling entirely
    config.module.noParse = /\.node$/

    // Mark packages with native addons as external on the server
    if (isServer) {
      const externals = config.externals || []
      config.externals = [
        ...externals,
        "cpu-features",
        "ssh2",
      ]
    }

    return config
  },
}

export default nextConfig
