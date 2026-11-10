import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// `npm test` runs the unit tests; `npm run perf` profiles the engine on the exported catalogue.
export default defineConfig(({ mode }) => ({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: mode === "perf" ? ["lib/**/*.bench.ts"] : ["lib/**/*.test.ts"], environment: "node" },
}));
