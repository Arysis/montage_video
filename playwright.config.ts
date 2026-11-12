import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;

// Environnement de test : services simulés, base et stockage dédiés.
const testEnv = {
  NODE_ENV: "production",
  APP_URL: BASE,
  APP_SECRET: "e2e-secret-0123456789-0123456789-0123456789",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/montage_e2e",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: ".data/e2e-storage",
  WORK_DIR: ".data/e2e-work",
  AI_PROVIDER: "mock",
  STT_PROVIDER: "mock",
  PUBLISH_PROVIDER: "mock",
  EMAIL_PROVIDER: "log",
  ALLOW_MOCK_IN_PRODUCTION: "1",
  FREE_VIDEOS_PER_MONTH: "5",
};

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "off",
    permissions: ["microphone"],
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.resolve(".data/e2e-fixtures/voix.wav")}`,
      ],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Les migrations d'abord, puis le worker et le serveur web (build déjà fait).
    command: `npm run db:migrate && (npm run worker & npx next start -p ${PORT})`,
    url: `${BASE}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: testEnv,
    stdout: "pipe",
    stderr: "pipe",
  },
});
