import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // PGlite instances are heavy; keep files isolated but bounded.
    maxWorkers: 4,
    server: { deps: { inline: [] } },
    alias: { "server-only": new URL("./tests/support/server-only-stub.ts", import.meta.url).pathname },
  },
});
