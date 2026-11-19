import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Offline engine replays (local data, optional private memory file): not part of `npm test`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["lib/**/*.eval.ts"], environment: "node", testTimeout: 600_000 },
});
