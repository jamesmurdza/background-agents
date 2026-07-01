import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Transpile workspace packages (source imports)
  // NOTE: @background-agents/claude-credentials is intentionally NOT transpiled — its
  // main entry imports @daytonaio/sdk which pulls in @opentelemetry/@grpc (Node-only).
  // Code that only needs the string constants imports the zero-dep
  // `@background-agents/claude-credentials/constants` subpath, which never reaches the SDK.
  transpilePackages: [
    "@background-agents/sdk",
    "@background-agents/agent-configuration",
    "@background-agents/common",
  ],
  // Keep @daytonaio/sdk on the server side
  serverExternalPackages: ["@daytonaio/sdk"],
  // Silences turbopack warning since we're using webpack
  turbopack: {},
}

export default nextConfig
