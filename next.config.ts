import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM build of Postgres and must run from Node with its own
  // loader rather than being bundled. Without this, Next's optimizer breaks
  // `WebAssembly.instantiate` and the embedded adapter cannot start.
  serverExternalPackages: ["@electric-sql/pglite", "@neondatabase/serverless"],
};

export default nextConfig;