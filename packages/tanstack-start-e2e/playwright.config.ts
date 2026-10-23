/**
 * The Playwright config that an app's tests run with, from its directory, with
 * TanStack's Playwright (see `scripts/test.ts`): the app's own
 * `playwright.config.ts`, serving the app with the plugin instead of with
 * Node.js, and without the tests skipped in `apps.ts`.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { findSuite, getAppDir } from "./apps.ts";
import type { PlaywrightTestConfig } from "@playwright/test";

// oxlint-disable-next-line turbo/no-undeclared-env-vars -- `scripts/test.ts` sets it, outside Turbo.
const suiteId = process.env.TANSTACK_START_E2E_SUITE ?? "";
const found = findSuite(suiteId);
if (found === undefined) {
	throw new Error(
		`Unknown suite "${suiteId}"; run the tests with scripts/test.ts`
	);
}
const { app, suite } = found;
const appDir = process.cwd();
if (getAppDir(app) !== appDir) {
	throw new Error(`Expected to run ${suiteId} in ${getAppDir(app)}`);
}

const { default: appConfig } = (await import(
	pathToFileURL(path.join(appDir, "playwright.config.ts")).href
)) as { default: PlaywrightTestConfig };
const appWebServer = appConfig.webServer;
if (appWebServer === undefined || Array.isArray(appWebServer)) {
	throw new Error(`Expected ${app.name} to have one web server`);
}

// This package's Rsbuild, which the plugin needs a newer version of than
// TanStack's lockfile has (see `node-hooks.ts`).
const rsbuild = path.join(import.meta.dirname, "node_modules/.bin/rsbuild");
const rsbuildArgs = `--config ${path.join(import.meta.dirname, "rsbuild.config.ts")} --config-loader native`;
// TanStack's tests read the port from the server's output.
const serveArgs = `${rsbuildArgs} --host 0.0.0.0 --port 0`;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const skips = suite.skips ?? [];

/** Resolves a path in the app's config, which is relative to the app. */
function resolveAppPath<T extends string | string[] | undefined>(value: T): T {
	if (value === undefined) {
		return value;
	}
	return (
		typeof value === "string"
			? path.resolve(appDir, value)
			: value.map((file) => path.resolve(appDir, file))
	) as T;
}

export default {
	...appConfig,
	testDir: path.resolve(appDir, appConfig.testDir ?? "."),
	globalSetup: resolveAppPath(appConfig.globalSetup),
	globalTeardown: resolveAppPath(appConfig.globalTeardown),
	outputDir: path.join(
		import.meta.dirname,
		"test-results",
		suiteId.replaceAll(":", "-")
	),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["github"]] : "list",
	grepInvert:
		skips.length > 0
			? skips.map(
					({ file, title }) =>
						new RegExp(
							`${escapeRegExp(file)}${title === undefined ? "" : `.*${escapeRegExp(title)}`}`
						)
				)
			: undefined,
	webServer: {
		...appWebServer,
		command:
			suite.serve === "dev"
				? `${rsbuild} dev ${serveArgs}`
				: `${rsbuild} build ${rsbuildArgs} && ${rsbuild} preview ${serveArgs}`,
		cwd: appDir,
		env: {
			...appWebServer.env,
			...suite.env,
			MODE: suite.mode,
			E2E_TOOLCHAIN: "rsbuild",
			NODE_OPTIONS: `${appWebServer.env?.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.join(import.meta.dirname, "register-node-hooks.ts")).href}`,
		},
		timeout: 180_000,
	},
} satisfies PlaywrightTestConfig;
