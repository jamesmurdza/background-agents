import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Transpile workspace packages (source imports)
  transpilePackages: [
    "background-agents",
    "@upstream/agent-configuration",
    "@upstream/common",
    "@upstream/claude-credentials",
  ],
  // Exclude Node-only packages from client bundles
  serverExternalPackages: ["@grpc/grpc-js", "@opentelemetry/sdk-node", "@opentelemetry/exporter-trace-otlp-grpc", "@opentelemetry/exporter-metrics-otlp-grpc", "@opentelemetry/exporter-logs-otlp-grpc", "@opentelemetry/otlp-grpc-exporter-base"],
}

export default nextConfig
