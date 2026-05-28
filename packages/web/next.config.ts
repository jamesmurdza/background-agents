import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Transpile workspace packages (source imports)
  // NOTE: @background-agents/claude-credentials removed — it imports @daytonaio/sdk which
  // pulls in @opentelemetry/@grpc with Node-only modules. Client code only needs
  // the string constants, which webpack can tree-shake when not transpiled.
  transpilePackages: [
    "background-agents",
    "@background-agents/agent-configuration",
    "@background-agents/common",
  ],
  // Keep @daytonaio/sdk on the server side
  serverExternalPackages: ["@daytonaio/sdk"],
  // Silences turbopack warning since we're using webpack
  turbopack: {},
}

export default nextConfig
