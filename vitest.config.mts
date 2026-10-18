import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@/": r("./src/"),
      // Unit tests run outside React Server Components; allow server-only modules.
      "server-only": r("./node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
