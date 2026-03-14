/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@jamesmurdza/coding-agents-sdk"],
}

export default nextConfig
