/**
 * Generates a patch changeset for each change since the last release, so that
 * the release notes are written from commit messages:
 *
 * - each commit in this repository that changes the plugin (other than its
 *   tests) gets a changeset with its subject;
 * - each commit that moves the workers-sdk submodule gets a changeset for each
 *   upstream commit in between that changes the Vite plugin, with its subject.
 *
 * The last release is the commit that last changed the plugin's version. If
 * that version isn't on npm yet, the release is still to be published, so no
 * changesets are generated, and `publish=true` is written to `$GITHUB_OUTPUT`.
 *
 * Usage: node --experimental-strip-types scripts/generate-changesets.ts
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pluginDir = "packages/rsbuild-plugin";
const upstreamDir = "workers-sdk";
const upstreamRepo = "cloudflare/workers-sdk";

/** The paths whose changes are released: the plugin, not its tests. */
const RELEASED_PATHS = [
	pluginDir,
	`:(glob,exclude)${pluginDir}/**/__tests__/**`,
];

/** The upstream paths whose changes are released: the Vite plugin, not its tests. */
const UPSTREAM_RELEASED_PATHS = [
	"packages/vite-plugin-cloudflare",
	":(exclude)packages/vite-plugin-cloudflare/CHANGELOG.md",
	":(exclude)packages/vite-plugin-cloudflare/e2e",
	":(exclude)packages/vite-plugin-cloudflare/playground",
	":(glob,exclude)packages/vite-plugin-cloudflare/**/__tests__/**",
];

/**
 * Marks the upstream changes, which `scripts/format-changelog.ts` moves under a
 * heading of their own.
 */
const upstreamPrefix = "From `@cloudflare/vite-plugin`: ";

/** Matches the commits that changesets/action makes to release. */
const versionCommitRE = /^Version Packages\b/;

/**
 * Matches the commits that `.github/workflows/sync-upstream.yml` makes, and
 * its pull requests' titles for when one is squash-merged by hand. Bumps are
 * released as the upstream commits that they bring in, and dependency updates
 * only change development dependencies, as the plugin's dependencies follow
 * the Vite plugin's.
 */
const syncCommitRE =
	/^(?:Bump workers-sdk to |Update dependencies$|Sync with workers-sdk )/;

/** Matches the scopes that commit subjects start with, e.g. `[vite-plugin] `. */
const scopeRE = /^(?:\[[^\]]+\]\s*)+/;

/**
 * Runs git and returns its trimmed output.
 *
 * @param args The arguments to git.
 * @param cwd The repository to run git in, relative to the root.
 * @returns The output.
 */
function git(args: string[], cwd = "."): string {
	return execFileSync("git", args, {
		cwd: path.join(root, cwd),
		encoding: "utf8",
	}).trim();
}

/**
 * Checks whether a version of a package is on npm.
 *
 * @param name The package's name.
 * @param version The version.
 * @returns Whether that version is published.
 */
function isPublished(name: string, version: string): boolean {
	try {
		const output = execFileSync(
			"npm",
			["view", `${name}@${version}`, "version"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}
		);
		return output.trim() === version;
	} catch (error) {
		// npm fails with E404 when the package doesn't exist at all.
		if (String((error as { stderr?: unknown }).stderr).includes("E404")) {
			return false;
		}
		throw error;
	}
}

/**
 * Turns a commit message into a changeset summary.
 *
 * @param message The commit message.
 * @returns The subject without its scopes.
 */
function toSummary(message: string): string {
	return (message.split("\n")[0] ?? "").replace(scopeRE, "");
}

/**
 * Lists the released upstream changes between two submodule commits.
 *
 * @param from The submodule commit before.
 * @param to The submodule commit after.
 * @returns A summary for each upstream commit, oldest first.
 */
function getUpstreamSummaries(from: string, to: string): string[] {
	const log = git(
		[
			"log",
			"--first-parent",
			"--reverse",
			"--format=%H %s",
			`${from}..${to}`,
			"--",
			...UPSTREAM_RELEASED_PATHS,
		],
		upstreamDir
	);
	return log
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const sha = line.slice(0, line.indexOf(" "));
			const subject = line.slice(sha.length + 1);
			return { sha, subject };
		})
		.filter(({ subject }) => !versionCommitRE.test(subject))
		.map(({ sha, subject }) => {
			const text = subject.replace(scopeRE, "");
			// Link upstream's pull request, or the commit if there isn't one.
			const linked = /\(#\d+\)/.test(text)
				? text.replace(/\(#(\d+)\)/g, `(${upstreamRepo}#$1)`)
				: `${text} (${upstreamRepo}@${sha.slice(0, 9)})`;
			return `${upstreamPrefix}${linked}`;
		});
}

const { name, version } = JSON.parse(
	readFileSync(path.join(root, pluginDir, "package.json"), "utf8")
) as { name: string; version: string };

if (!isPublished(name, version)) {
	console.log(`${name}@${version} isn't published yet, so it will be.`);
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, "publish=true\n");
	}
	process.exit(0);
}

const lastRelease = git([
	"log",
	"-1",
	"--format=%H",
	"-G",
	'"version":',
	"--",
	`${pluginDir}/package.json`,
]);
const commits = git([
	"rev-list",
	"--first-parent",
	"--reverse",
	`${lastRelease}..HEAD`,
])
	.split("\n")
	.filter(Boolean);

const summaries: { id: string; summary: string }[] = [];
for (const commit of commits) {
	const message = git(["log", "-1", "--format=%B", commit]);
	if (versionCommitRE.test(message)) {
		continue;
	}
	const shortSha = commit.slice(0, 9);

	const upstreamBefore = git(["rev-parse", `${commit}^:${upstreamDir}`]);
	const upstreamAfter = git(["rev-parse", `${commit}:${upstreamDir}`]);
	if (upstreamBefore !== upstreamAfter) {
		for (const [index, summary] of getUpstreamSummaries(
			upstreamBefore,
			upstreamAfter
		).entries()) {
			summaries.push({ id: `${shortSha}-upstream-${index}`, summary });
		}
	}
	if (syncCommitRE.test(message)) {
		continue;
	}

	const changed = git([
		"diff-tree",
		"--no-commit-id",
		"--name-only",
		"-r",
		commit,
		"--",
		...RELEASED_PATHS,
	]);
	if (changed) {
		summaries.push({ id: shortSha, summary: toSummary(message) });
	}
}

// The changelog lists changesets in file name order, so number them.
for (const [index, { id, summary }] of summaries.entries()) {
	const file = `.changeset/generated-${String(index).padStart(4, "0")}-${id}.md`;
	writeFileSync(
		path.join(root, file),
		`---\n${JSON.stringify(name)}: patch\n---\n\n${summary}\n`
	);
	console.log(`Wrote ${file}: ${summary}`);
}
console.log(
	`Generated ${summaries.length} changesets since ${lastRelease.slice(0, 9)}.`
);
