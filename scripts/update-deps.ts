/**
 * Updates the dependencies that this repository owns, rather than following
 * workers-sdk (see `scripts/sync-upstream-deps.ts`), to the latest versions in
 * their ranges, and refreshes the lockfile. Those are the dependencies with
 * `^` or `~` ranges: the ones that follow workers-sdk are pinned or linked.
 *
 * Then lists the newer versions outside those ranges, with how to update each:
 * they may break the plugin (e.g. a new major version of `@rsbuild/core` may
 * need the plugin's peer dependency range to change), so they aren't updated
 * here. The daily sync's agent updates them, each in a commit of its own (see
 * UPSTREAM.md).
 *
 * Usage: node --experimental-strip-types scripts/update-deps.ts [--report <file>] [--outdated <file>]
 *
 * `--report` writes the list as Markdown, and `--outdated` as JSON: an array
 * of `{name, range, latest, usedBy}`, `usedBy` being the directories of the
 * package.json files that depend on it.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface PackageJson {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

const root = path.resolve(import.meta.dirname, "..");

/**
 * Gets the value of a command-line option.
 *
 * @param name The option, e.g. `--report`.
 * @returns Its value, or `undefined` when it isn't given.
 */
function getOption(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

const reportPath = getOption("--report");
const outdatedPath = getOption("--outdated");

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

/** A dependency with a newer version outside its range. */
interface Outdated {
	name: string;
	range: string;
	latest: string;
	usedBy: string[];
}

const outOfRange: Outdated[] = [];
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
		outOfRange.push({ name, range, latest, usedBy });
	}
}

const report =
	outOfRange.length === 0
		? ""
		: [
				"These dependencies have newer versions outside their ranges. To update one, raise its range in each package.json that uses it, run `pnpm install`, adapt the plugin to the version's breaking changes (see its changelog), and run the checks and tests:",
				"",
				...outOfRange.map(
					({ name, range, latest, usedBy }) =>
						`- \`${name}\`: \`${range}\` → \`${latest}\` (${usedBy.join(", ")})`
				),
				"",
			].join("\n");
console.log(report || "All dependencies are within their ranges.");
if (reportPath) {
	writeFileSync(reportPath, report);
}
if (outdatedPath) {
	writeFileSync(outdatedPath, `${JSON.stringify(outOfRange, null, "\t")}\n`);
}
