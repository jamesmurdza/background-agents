import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@jamesmurdza/coding-agents-sdk"],
  turbopack: {
    resolveAlias: {
      "@jamesmurdza/coding-agents-sdk": "./node_modules/@jamesmurdza/coding-agents-sdk",
    },
  },
  webpack: (config) => {
    config.resolve.alias["@jamesmurdza/coding-agents-sdk"] = path.join(
      __dirname,
      "node_modules/@jamesmurdza/coding-agents-sdk"
    )
    return config
  },
}

export default nextConfig
