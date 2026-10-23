/**
 * Prepares the TanStack/router checkout that the tests run in: checks out the
 * commit pinned in `upstream.json`, installs the apps' dependencies with
 * TanStack's own pnpm and lockfile, and builds the TanStack packages that they
 * use from source, so that the apps' tests run against the code that they were
 * written for.
 *
 * Usage: node --experimental-strip-types scripts/setup.ts
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { apps, getAppDir, tanstackRouterDir } from "../apps.ts";
import upstream from "../upstream.json" with { type: "json" };

function run(command: string, args: string[], cwd = tanstackRouterDir): void {
	console.log(`$ ${command} ${args.join(" ")}`);
	execFileSync(command, args, {
		cwd,
		stdio: "inherit",
		env: {
			...process.env,
			// Nx's daemon and remote cache would outlive or reach beyond this script.
			NX_DAEMON: "false",
			NX_NO_CLOUD: "true",
			NX_TUI: "false",
		},
	});
}

function git(args: string[]): string {
	return execFileSync("git", ["-C", tanstackRouterDir, ...args], {
		encoding: "utf8",
	}).trim();
}

function readPackageJson(dir: string): {
	name: string;
	packageManager?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
} {
	return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
}

function getHead(): string | undefined {
	try {
		return git(["rev-parse", "HEAD"]);
	} catch {
		// A new repository has no commits.
		return undefined;
	}
}

if (!fs.existsSync(path.join(tanstackRouterDir, ".git"))) {
	fs.mkdirSync(tanstackRouterDir, { recursive: true });
	git(["init", "--quiet"]);
}
if (getHead() !== upstream.commit) {
	run("git", ["fetch", "--depth", "1", upstream.repository, upstream.commit]);
	// `--force` discards changes that earlier runs left in the checkout.
	run("git", ["checkout", "--force", "--detach", "FETCH_HEAD"]);
}

const appPackages = apps.map((app) => readPackageJson(getAppDir(app)));

// TanStack's own pnpm, whose major version may differ from this repository's.
const { packageManager } = readPackageJson(tanstackRouterDir);
if (packageManager?.startsWith("pnpm@") !== true) {
	throw new Error(
		`Unexpected packageManager in TanStack/router: ${packageManager}`
	);
}
const pnpm = ["--yes", packageManager.split("+")[0] ?? packageManager];

run("npx", [
	...pnpm,
	"install",
	"--frozen-lockfile",
	// The workspace root holds Nx, which builds the packages.
	"--filter",
	".",
	...appPackages.flatMap(({ name }) => ["--filter", `${name}...`]),
]);

const workspaceDependencies = new Set(
	appPackages.flatMap(({ dependencies, devDependencies }) =>
		Object.entries({ ...dependencies, ...devDependencies })
			.filter(([, version]) => version.startsWith("workspace:"))
			.map(([name]) => name)
	)
);
run("npx", [
	...pnpm,
	"exec",
	"nx",
	"run-many",
	"--target",
	"build",
	"--outputStyle",
	"static",
	"--projects",
	[...workspaceDependencies].join(","),
]);
