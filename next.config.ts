import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Visit photos up to 10 MB are uploaded through a Server Action (plus multipart overhead)
    serverActions: { bodySizeLimit: "11mb" },
    // The proxy buffers dashboard request bodies; keep the same limit
    proxyClientMaxBodySize: "11mb",
  },
};

export default nextConfig;
