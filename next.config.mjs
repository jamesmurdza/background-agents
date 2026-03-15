import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sdkPath = path.join(__dirname, "node_modules/@jamesmurdza/coding-agents-sdk")

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  serverExternalPackages: ["ssh2", "cpu-features"],
  transpilePackages: ["@jamesmurdza/coding-agents-sdk"],
  turbopack: {
    resolveAlias: {
      "@jamesmurdza/coding-agents-sdk": "./node_modules/@jamesmurdza/coding-agents-sdk",
    },
  },
  webpack: (config) => {
    config.resolve.alias["@jamesmurdza/coding-agents-sdk"] = sdkPath
    config.module.rules.push({ test: /\.node$/, type: "asset/resource" })
    return config
  },
}

export default nextConfig
