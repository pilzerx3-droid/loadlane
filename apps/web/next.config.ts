import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

// Next.js only reads .env files inside apps/web. The repository keeps one .env at its root, so load
// it here. Variables that are already set in the environment win.
const repositoryRoot = join(import.meta.dirname, "..", "..");
const rootEnvFile = join(repositoryRoot, ".env");
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["ioredis"],
  // The UI package is shipped as TypeScript source.
  transpilePackages: ["@loadlane/ui", "@loadlane/shared"],
  turbopack: { root: repositoryRoot },
  headers() {
    return Promise.resolve([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ]);
  },
};

export default config;
