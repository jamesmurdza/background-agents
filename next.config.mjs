import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkPath = path.join(__dirname, "node_modules/@jamesmurdza/coding-agents-sdk")

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
    config.resolve.alias["@jamesmurdza/coding-agents-sdk"] = sdkPath
    return config
  },
}

export default nextConfig
