/**
 * Updates the dependencies that this repository owns, rather than following
 * workers-sdk (see `scripts/sync-upstream-deps.ts`), to the latest versions in
 * their ranges, and refreshes the lockfile. Those are the dependencies with
 * `^` or `~` ranges: the ones that follow workers-sdk are pinned or linked.
 *
 * Then lists the newer versions outside those ranges, which need updating by
 * hand (e.g. a new major version of `@rsbuild/core` may need the plugin's peer
 * dependency range to change).
 *
 * Usage: node --experimental-strip-types scripts/update-deps.ts [--report <file>]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

const root = path.resolve(import.meta.dirname, "..");
const reportIndex = process.argv.indexOf("--report");
const reportPath =
	reportIndex === -1 ? undefined : process.argv[reportIndex + 1];

/** Matches the ranges of the dependencies that this repository owns. */
const ownRangeRE = /^[\^~](\d+)\.(\d+)\.\d+/;

/**
 * Runs a command in the root, showing its output.
 *
 * @param command The command.
 * @param args Its arguments.
 */
function run(command: string, args: string[]): void {
	execFileSync(command, args, { cwd: root, stdio: "inherit" });
}

/**
 * Gets the part of a version that changes when it breaks compatibility, as
 * `^` ranges see it: the major version, or the minor version of a `0.x`.
 *
 * @param major The major version.
 * @param minor The minor version.
 * @returns The breaking part, e.g. `2` or `0.4`.
 */
function getBreakingPart(major: string, minor: string): string {
	return major === "0" ? `0.${minor}` : major;
}

run("pnpm", ["update", "--recursive"]);
// Puts back anything that should follow workers-sdk.
run("node", ["--experimental-strip-types", "scripts/sync-upstream-deps.ts"]);
run("pnpm", ["install", "--no-frozen-lockfile"]);

// The dependencies with `^` or `~` ranges, and where they're used.
const ranges = new Map<string, { range: string; usedBy: string[] }>();
for (const directory of [
	".",
	...readdirSync(path.join(root, "packages")).map((name) =>
		path.join("packages", name)
	),
	...readdirSync(path.join(root, "packages/e2e/fixtures")).map((name) =>
		path.join("packages/e2e/fixtures", name)
	),
]) {
	const packageJson = JSON.parse(
		readFileSync(path.join(root, directory, "package.json"), "utf8")
	) as PackageJson;
	for (const [name, range] of Object.entries({
		...packageJson.dependencies,
		...packageJson.devDependencies,
	})) {
		if (ownRangeRE.test(range)) {
			const entry = ranges.get(name) ?? { range, usedBy: [] };
			entry.usedBy.push(directory);
			ranges.set(name, entry);
		}
	}
}

const outOfRange: string[] = [];
for (const [name, { range, usedBy }] of ranges) {
	const latest = execFileSync("npm", ["view", name, "version"], {
		encoding: "utf8",
	}).trim();
	const [, rangeMajor = "", rangeMinor = ""] = ownRangeRE.exec(range) ?? [];
	const [latestMajor = "", latestMinor = ""] = latest.split(".");
	if (
		getBreakingPart(latestMajor, latestMinor) !==
		getBreakingPart(rangeMajor, rangeMinor)
	) {
		outOfRange.push(
			`- \`${name}\`: \`${range}\` → \`${latest}\` (${usedBy.join(", ")})`
		);
	}
}

const report =
	outOfRange.length === 0
		? ""
		: [
				"These dependencies have newer versions outside their ranges, which need updating by hand:",
				"",
				...outOfRange,
				"",
			].join("\n");
console.log(report || "All dependencies are within their ranges.");
if (reportPath) {
	writeFileSync(reportPath, report);
}
