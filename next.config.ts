// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This configures Webpack for production builds (`next build`)
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      uuid: require.resolve("uuid"),
    };
    return config;
  },
  // This configures Turbopack for development (`next dev --turbo`)
  turbopack: {
    resolveAlias: {
      // This tells Turbopack to resolve any import of 'uuid' to the actual 'uuid' package's entry point.
      uuid: require.resolve("uuid"),
    },
  },
};

export default nextConfig;
