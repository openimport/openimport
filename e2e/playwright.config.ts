import { defineConfig, devices } from '@playwright/test'

const PORT = 4179

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      // Locally use the installed Chrome; CI installs Playwright's Chromium.
      use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
  ],
  // The production build, so the worker is bundled exactly as it ships.
  webServer: {
    command: `pnpm --filter web build && pnpm --filter web exec vite preview --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}/playground/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
