import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only drivers stay as runtime requires; node:sqlite is a Node builtin.
  serverExternalPackages: ["mysql2", "@anthropic-ai/sdk"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : []), { "node:sqlite": "commonjs node:sqlite" }];
    }
    return config;
  },
};

export default nextConfig;
