/**
 * Runs the suites in `apps.ts`, each with TanStack's Playwright and this
 * package's `playwright.config.ts` wrapper. Run `scripts/setup.ts` first.
 *
 * Suites are selected by ID, or by the start of one (e.g. `basic` or
 * `basic:preview`), and by how they're served. Playwright options can be passed
 * on after `--`.
 *
 * Usage: node --experimental-strip-types scripts/test.ts [--serve dev|preview] [suite...] [-- <playwright args>]
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { apps, getAppDir, getSuiteId, tanstackRouterDir } from "../apps.ts";

const separator = process.argv.indexOf("--");
const { values, positionals: filters } = parseArgs({
	args: process.argv.slice(2, separator === -1 ? undefined : separator),
	options: { serve: { type: "string" } },
	allowPositionals: true,
});
const playwrightArgs =
	separator === -1 ? [] : process.argv.slice(separator + 1);

if (
	values.serve !== undefined &&
	values.serve !== "dev" &&
	values.serve !== "preview"
) {
	throw new Error(`Expected --serve dev or preview, not "${values.serve}"`);
}

function matches(id: string, filter: string): boolean {
	return id === filter || id.startsWith(`${filter}:`);
}

const suites = apps.flatMap((app) =>
	app.suites
		.map((suite) => ({ app, suite, id: getSuiteId(app, suite) }))
		.filter(
			({ suite, id }) =>
				(values.serve === undefined || suite.serve === values.serve) &&
				(filters.length === 0 || filters.some((filter) => matches(id, filter)))
		)
);
for (const filter of filters) {
	if (!suites.some(({ id }) => matches(id, filter))) {
		throw new Error(`No suite matches "${filter}"`);
	}
}

const failed: string[] = [];
for (const { app, suite, id } of suites) {
	const appDir = getAppDir(app);
	console.log(`\n${id}\n`);
	// Upstream reads the Worker's config from the app's directory. Some apps
	// have a Wrangler config there, for TanStack's own Cloudflare runs, which
	// upstream refuses to ignore without a `cloudflare.config.ts`.
	fs.writeFileSync(
		path.join(appDir, "cloudflare.config.ts"),
		`export { default } from ${JSON.stringify(path.join(import.meta.dirname, "../cloudflare.config.ts"))};\n`
	);
	// TanStack's root Playwright: not every app depends on it itself.
	const { status, error } = spawnSync(
		path.join(tanstackRouterDir, "node_modules/.bin/playwright"),
		[
			"test",
			"--config",
			path.join(import.meta.dirname, "../playwright.config.ts"),
			"--project=chromium",
			...playwrightArgs,
		],
		{
			cwd: appDir,
			stdio: "inherit",
			// The apps' configs and tests read these, as in TanStack's own runs.
			env: {
				...process.env,
				...suite.env,
				MODE: suite.mode,
				E2E_TOOLCHAIN: "rsbuild",
				TANSTACK_START_E2E_SUITE: id,
			},
		}
	);
	if (error !== undefined) {
		throw error;
	}
	if (status !== 0) {
		failed.push(id);
	}
}

if (failed.length > 0) {
	console.error(`\nFailed: ${failed.join(", ")}`);
	process.exit(1);
}
