import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real static build (`npm run build` -> out/, with the catalogue in out/data).
 * External services (Wikidata, Deezer...) are mocked per test where a page depends on them.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  webServer: { command: "node e2e/serve.mjs out 4321", url: "http://127.0.0.1:4321", reuseExistingServer: !process.env.CI, timeout: 30_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
