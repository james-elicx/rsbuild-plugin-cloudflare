import * as path from "node:path";
import { defineConfig } from "@playwright/test";
import type { PlaywrightTestConfig } from "@playwright/test";

/** How the apps are served: by `rsbuild dev`, or by `rsbuild preview` after `rsbuild build`. */
export type Mode = "dev" | "preview";

/**
 * The apps in `fixtures/`. Each one is served on its own port, and tested by
 * `tests/<name>.spec.ts`.
 */
const apps = [
	{ name: "tanstack-start", port: 4310 },
	{ name: "tanstack-start-rsc", port: 4311 },
];

/**
 * Creates the Playwright config that serves and tests every app in one mode.
 * The modes have separate configs because Playwright starts every web server
 * in a config, and an app's dev server and build can't run at the same time.
 *
 * @param mode How the apps are served.
 * @returns The Playwright config.
 */
export function createConfig(mode: Mode): PlaywrightTestConfig {
	return defineConfig({
		testDir: "tests",
		forbidOnly: !!process.env.CI,
		retries: process.env.CI ? 1 : 0,
		reporter: process.env.CI ? [["list"], ["github"]] : "list",
		outputDir: `test-results/${mode}`,
		use: { trace: "retain-on-failure" },
		projects: apps.map(({ name, port }) => ({
			name: `${name} (${mode})`,
			testMatch: `${name}.spec.ts`,
			metadata: { mode },
			use: { baseURL: `http://localhost:${port}` },
		})),
		webServer: apps.map(({ name, port }) => ({
			// The apps' own `build` scripts also type-check them.
			command:
				mode === "dev"
					? `pnpm exec rsbuild dev --port ${port}`
					: `pnpm run build && pnpm exec rsbuild preview --port ${port}`,
			cwd: path.join(import.meta.dirname, "fixtures", name),
			url: `http://localhost:${port}`,
			// Always test a server started from the current sources.
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: "pipe",
			gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
		})),
	});
}
