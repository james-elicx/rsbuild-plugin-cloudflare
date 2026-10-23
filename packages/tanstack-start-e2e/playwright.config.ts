/**
 * The Playwright config that an app's tests run with, from its directory, with
 * the app's own Playwright (see `scripts/test.ts`): the app's own
 * `playwright.config.ts`, serving the app with the plugin instead of with
 * Node.js, and without the tests skipped in `apps.ts`.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { apps, getAppDir } from "./apps.ts";
import type { Mode } from "./apps.ts";
import type { PlaywrightTestConfig } from "@playwright/test";

const appDir = process.cwd();
const app = apps.find((candidate) => getAppDir(candidate) === appDir);
if (app === undefined) {
	throw new Error(`${appDir} isn't an app in apps.ts`);
}
// oxlint-disable-next-line turbo/no-undeclared-env-vars -- `scripts/test.ts` sets it, outside Turbo, as TanStack's configs read it.
const mode = process.env.MODE as Mode;
if (!app.modes.includes(mode)) {
	throw new Error(`${app.name} isn't tested in mode "${mode}"`);
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

const skips = app.skips?.[mode] ?? [];

export default {
	...appConfig,
	testDir: path.resolve(appDir, appConfig.testDir ?? "."),
	outputDir: path.join(import.meta.dirname, "test-results", app.name, mode),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["github"]] : "list",
	grepInvert:
		skips.length > 0
			? skips.map(
					({ file, title }) =>
						new RegExp(`${escapeRegExp(file)}.*${escapeRegExp(title)}`)
				)
			: undefined,
	webServer: {
		...appWebServer,
		command:
			mode === "dev"
				? `${rsbuild} dev ${serveArgs}`
				: `${rsbuild} build ${rsbuildArgs} && ${rsbuild} preview ${serveArgs}`,
		cwd: appDir,
		env: {
			...appWebServer.env,
			MODE: mode,
			E2E_TOOLCHAIN: "rsbuild",
			NODE_OPTIONS: `${appWebServer.env?.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.join(import.meta.dirname, "register-node-hooks.ts")).href}`,
		},
		timeout: 180_000,
	},
} satisfies PlaywrightTestConfig;
