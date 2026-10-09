import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke test for /sandbox. Expects the client on :3100 and the forceteki sandbox server on :9600 to be
 * running already (see PROGRESS-client.md). Override the client URL with SANDBOX_URL.
 */
export default defineConfig({
    testDir: '.',
    timeout: 180_000,
    expect: { timeout: 20_000 },
    // one browser at a time (each page boots its own engine worker), and one retry: this machine is shared with
    // engine builds and test runs, and a stall there should not read as a sandbox failure
    workers: 1,
    retries: 1,
    reporter: [['list']],
    use: {
        baseURL: process.env.SANDBOX_URL ?? 'http://localhost:3100',
        viewport: { width: 1680, height: 1000 },
        trace: 'retain-on-failure',
        permissions: ['clipboard-read', 'clipboard-write'],
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1680, height: 1000 } } }],
});
