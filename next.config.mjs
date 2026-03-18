import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkPath = path.join(__dirname, "node_modules/@jamesmurdza/coding-agents-sdk")

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // Mark native addon packages as external so they're not bundled by webpack
  serverExternalPackages: [
    "ssh2",
    "cpu-features",
    "@jamesmurdza/coding-agents-sdk",
  ],
  turbopack: {
    resolveAlias: {
      "@jamesmurdza/coding-agents-sdk": "./node_modules/@jamesmurdza/coding-agents-sdk",
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias["@jamesmurdza/coding-agents-sdk"] = sdkPath

    // Exclude .node files from webpack bundling entirely
    config.module.noParse = /\.node$/

    // Mark packages with native addons as external on the server
    if (isServer) {
      const externals = config.externals || []
      config.externals = [
        ...externals,
        "cpu-features",
        "ssh2",
        "@jamesmurdza/coding-agents-sdk",
      ]
    }

    return config
  },
}

export default nextConfig
