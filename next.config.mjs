import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkPath = path.join(__dirname, "node_modules/background-agents")

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "**.daytonaproxy01.net",
  ],
  images: {
    unoptimized: true,
  },
  // Mark native addon packages as external so they're not bundled by webpack
  serverExternalPackages: [
    "ssh2",
    "cpu-features",
    "background-agents",
  ],
  turbopack: {
    resolveAlias: {
      "background-agents": "./node_modules/background-agents",
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias["background-agents"] = sdkPath

    // Exclude .node files from webpack bundling entirely
    config.module.noParse = /\.node$/

    // Mark packages with native addons as external on the server
    if (isServer) {
      const externals = config.externals || []
      config.externals = [
        ...externals,
        "cpu-features",
        "ssh2",
        "background-agents",
      ]
    }

    return config
  },
}

export default nextConfig
