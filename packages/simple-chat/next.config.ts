import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Treat @upstream/agents as external (don't bundle)
  serverExternalPackages: ["@upstream/agents"],
}

export default nextConfig
