import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WEB_PORT ?? 4801);
// Use a specific Chromium binary when the default download is unavailable (offline hosts).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
// A synthetic microphone so voice recording can be tested without hardware or prompts.
const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    launchOptions: { executablePath, args },
  },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 880 },
        launchOptions: { executablePath, args },
      },
      testIgnore: /screenshots|mobile|widget-example/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions: { executablePath, args } },
      testMatch: /mobile\.spec/,
    },
    {
      name: 'example',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args } },
      testMatch: /widget-example\.spec/,
    },
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath, args } },
      testMatch: /screenshots\.spec/,
    },
  ],
  // CI starts both servers (see .github/workflows/ci.yml); locally they are usually running already.
  webServer: process.env.E2E_START_SERVERS
    ? [
        {
          command:
            'cd ../server && python manage.py migrate --noinput && python manage.py seed_demo && daphne -b 127.0.0.1 -p 4800 core.asgi:application',
          url: 'http://127.0.0.1:4800/api/health/',
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: `npx vite --port ${port} --strictPort`,
          url: `http://127.0.0.1:${port}/`,
          reuseExistingServer: true,
        },
      ]
    : undefined,
});
