import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DuckDB ships a native binding; keep it out of the bundle.
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
