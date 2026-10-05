import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.js",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.APP_TEST_URL || "http://localhost:3001",
    headless: true,
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
