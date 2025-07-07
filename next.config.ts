// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // This is the crucial part.
    // It resolves the an alias for the 'uuid' package to avoid a module resolution issue.
    config.resolve.alias = {
      ...config.resolve.alias,
      uuid: require.resolve("uuid"),
    };
    return config;
  },
};

export default nextConfig;
