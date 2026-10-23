/**
 * Runs the apps' Playwright tests with the plugin, in one mode, with each app's
 * own Playwright and `playwright.config.ts` wrapper. Run `scripts/setup.ts`
 * first.
 *
 * Usage: node --experimental-strip-types scripts/test.ts <dev|preview> [app...] [-- <playwright args>]
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { apps, getAppDir } from "../apps.ts";
import type { Mode } from "../apps.ts";

const separator = process.argv.indexOf("--");
const [mode, ...names] = process.argv.slice(
	2,
	separator === -1 ? undefined : separator
);
const playwrightArgs =
	separator === -1 ? [] : process.argv.slice(separator + 1);

if (mode !== "dev" && mode !== "preview") {
	throw new Error(`Expected a mode, "dev" or "preview", not "${mode}"`);
}
for (const name of names) {
	if (!apps.some((app) => app.name === name)) {
		throw new Error(`Unknown app "${name}"`);
	}
}

const failed: string[] = [];
for (const app of apps) {
	if (
		!app.modes.includes(mode satisfies Mode) ||
		(names.length > 0 && !names.includes(app.name))
	) {
		continue;
	}
	const appDir = getAppDir(app);
	console.log(`\n${app.name} (${mode})\n`);
	const { status } = spawnSync(
		path.join(appDir, "node_modules/.bin/playwright"),
		[
			"test",
			"--config",
			path.join(import.meta.dirname, "../playwright.config.ts"),
			"--project=chromium",
			...playwrightArgs,
		],
		{ cwd: appDir, stdio: "inherit", env: { ...process.env, MODE: mode } }
	);
	if (status !== 0) {
		failed.push(app.name);
	}
}

if (failed.length > 0) {
	console.error(`\nFailed: ${failed.join(", ")}`);
	process.exit(1);
}
